const CONFIG = {
    sheets: {
        food: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRRw4HteY6fsmDuDkQKqUSKiK4KK-13wqsPP4XVr4lQzCKFd_5GckUnJujDpzoHhdQWCpHtHDTdMnhj/pub?gid=961397190&single=true&output=csv",
        store: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRRw4HteY6fsmDuDkQKqUSKiK4KK-13wqsPP4XVr4lQzCKFd_5GckUnJujDpzoHhdQWCpHtHDTdMnhj/pub?gid=1090856077&single=true&output=csv",
        music: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRRw4HteY6fsmDuDkQKqUSKiK4KK-13wqsPP4XVr4lQzCKFd_5GckUnJujDpzoHhdQWCpHtHDTdMnhj/pub?gid=0&single=true&output=csv"
    }
};

let state = { 
    userLoc: null, 
    currentCategory: null, 
    dataCache: [],
    pointers: { food: 0, store: 0, music: 0 },
    isLocating: false,
    locationStatus: 'idle' 
};

const SG_CENTER = { lat: 1.3048, lng: 103.8318 };

// -----------------------------
// NEW: UI ENHANCEMENTS (Loader & Hero Toast)
// -----------------------------
function toggleLoader(show) {
    const loader = document.getElementById('loading-overlay');
    if (show) {
        loader.classList.remove('hidden');
    } else {
        loader.classList.add('hidden');
    }
}

function showHeroToast() {
    const toast = document.getElementById('hero-toast');
    toast.classList.remove('hidden');
    // Hide toast after 3.5 seconds
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3500);
}

// Updated Share Logic: Shares the specific item link
async function shareSpot(name, specificUrl) {
    const shareData = {
        title: name,
        text: `Supporting Local: Check out ${name}! Found on SG Vibes. 🇸🇬`,
        url: specificUrl 
    };

    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            await navigator.clipboard.writeText(specificUrl);
            alert("Link copied! Share it to support this local gem.");
        }
    } catch (err) { console.log('Share aborted'); }
}

// Intercept function for the "Hero" transition
function heroRedirect(url) {
    const overlay = document.createElement('div');
    overlay.className = 'hero-transition';
    overlay.innerHTML = `
        <p>Your support helps our local food, shops, and musicians thrive.</p>
    `;
    document.body.appendChild(overlay);

    // Extended delay to 2 seconds for readability
    setTimeout(() => {
        window.open(url, '_blank');
        overlay.remove();
    }, 3000);
}

// -----------------------------
// HELPERS & GEOLOCATION
// -----------------------------
function isInstagramBrowser() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    return /Instagram/i.test(ua);
}

const secureParseCSV = (row) => {
    const regex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
    return row.split(regex).map(cell => {
        let clean = cell.trim();
        if (clean.startsWith('"') && clean.endsWith('"')) {
            clean = clean.substring(1, clean.length - 1);
        }
        return clean.replace(/""/g, '"');
    });
};

function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 999;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

async function getLocation() {
    if (state.locationStatus === 'resolved') return state.userLoc || SG_CENTER;
    state.locationStatus = 'requesting';

    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            fallbackLocation(resolve, "Geolocation not supported");
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                state.locationStatus = 'resolved';
                resolve(state.userLoc);
            },
            (error) => {
                fallbackLocation(resolve, error.message);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });
}

function fallbackLocation(resolve, reason) {
    const alertBox = document.getElementById("distance-alert");
    if (alertBox) {
        alertBox.classList.remove("hidden");
        let message = `📍 Unable to get precise location. Showing general results.<br>`;
        if (isInstagramBrowser()) message += `👉 For accuracy, tap <b>•••</b> → <b>Open in Browser</b>`;
        alertBox.innerHTML = message;
    }
    state.userLoc = SG_CENTER;
    state.locationStatus = 'resolved';
    resolve(SG_CENTER);
}

// -----------------------------
// MAIN ACTION HANDLER
// -----------------------------
async function handleAction(category) {
    if (state.isLocating) return; 
    
    const resultsDiv = document.getElementById("results");

    // UI Updates
    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`${category}Btn`)?.classList.add('active');

    // Trigger NEW Loader
    toggleLoader(true);

    try {
        state.isLocating = true;

        const [userCoords, text] = await Promise.all([
            getLocation(),
            state.currentCategory !== category 
                ? fetch(CONFIG.sheets[category]).then(r => r.text()) 
                : Promise.resolve(null)
        ]);

        if (text) {
            state.currentCategory = category;
            state.dataCache = text.split("\n").slice(1)
                .map((row, index) => ({ id: index, cols: secureParseCSV(row.trim()) }))
                .filter(item => item.cols.length >= 5);

            state.pointers[category] = 0; 
        }

        if (category !== 'music') {
            state.dataCache.forEach(item => {
                const lat = parseFloat(item.cols[2]);
                const lng = parseFloat(item.cols[3]);
                item.dist = calculateDistance(userCoords.lat, userCoords.lng, lat, lng);
            });
            if (state.pointers[category] === 0) {
                state.dataCache.sort((a, b) => a.dist - b.dist);
            }
        }

        let selection = state.dataCache.slice(state.pointers[category], state.pointers[category] + 2);
        state.pointers[category] += 2;

        if (selection.length === 0 && state.dataCache.length > 0) {
            resultsDiv.innerHTML = `
                <div style="grid-column:1/-1;text-align:center;padding:40px;">
                    <button onclick="resetList('${category}')" class="category-btn active" style="margin: 0 auto; width: auto; padding: 10px 20px;">
                        🔄 Start Over
                    </button>
                </div>`;
        } else {
            resultsDiv.innerHTML = "";
            selection.forEach(item => resultsDiv.appendChild(renderCard(item, category)));
            window.scrollTo({ top: resultsDiv.offsetTop - 120, behavior: 'smooth' });
        }

    } catch (e) {
        console.error("Fetch error:", e);
    } finally {
        state.isLocating = false;
        // Hide NEW Loader after 500ms to ensure a smooth transition
        setTimeout(() => toggleLoader(false), 500);
    }
}

// -----------------------------
// RENDERING (With NEW Share & Hero Toast Logic)
// -----------------------------
function renderCard(item, category) {
    // ... (Keep existing data extraction logic at the top of the function)
    const [name, type, lat, lng, desc, musicUrl, mapsUrl] = item.cols;
    
    // ... (Keep existing card creation logic)
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
        <div class="img-container">
            <img src="https://images.unsplash.com/photo-${imgId}?auto=format&fit=crop&w=600&q=60" class="card-img">
            <span class="dist-tag"></span>
        </div>
        <div class="card-content">
            <span class="category-tag"></span>
            <h3></h3>
            <p></p>
            <div class="card-footer" style="display:flex; gap:8px;"></div>
        </div>`;

    card.querySelector('h3').textContent = name || "Local Spot";
    card.querySelector('p').textContent = desc || "Tap below for details";
    card.querySelector('.category-tag').textContent = type || category;

    const footer = card.querySelector('.card-footer');
    const targetUrl = (category === 'music' && musicUrl) ? musicUrl : (mapsUrl || "#");
    
    // Primary Action: Open Google Maps or Spotify
    const mainBtn = document.createElement('button');
    mainBtn.className = "btn-link";
    mainBtn.style.flex = "2";
    // Specific Labels for Clarity
    mainBtn.textContent = (category === 'music') ? "🎵 Open Spotify" : "📍 Open Google Maps";
    mainBtn.onclick = () => heroRedirect(targetUrl);
    
    // Secondary Action: Share this specific item
    const shareBtn = document.createElement('button');
    // Using the new secondary class for hover effects
    shareBtn.className = "btn-link btn-share-secondary";
    shareBtn.style.flex = "1";
    shareBtn.innerHTML = "🔗 Share";
    shareBtn.onclick = () => shareSpot(name, targetUrl);
    
    footer.appendChild(mainBtn);
    footer.appendChild(shareBtn);

    return card;
}

function resetList(cat) {
    state.pointers[cat] = 0;
    handleAction(cat);
}

function shareApp() {
    const appData = {
        title: 'SG Vibes',
        text: 'Discover the best local food, shops, and music in Singapore! 🇸🇬',
        url: 'https://upnextinsg.github.io/sg-vibes/'
    };
    if (navigator.share) {
        navigator.share(appData);
    } else {
        navigator.clipboard.writeText(appData.url);
        alert("App link copied! Spread the vibes.");
    }
}

// -----------------------------
// INITIALIZATION
// -----------------------------
window.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('tutorial-overlay');
    const closeBtn = document.getElementById('close-tutorial');
    overlay.classList.remove('hidden');

    closeBtn.addEventListener('click', () => {
        overlay.classList.add('hidden');
        handleAction('food');
    });
});
