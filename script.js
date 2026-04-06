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
    locationStatus: 'idle' // 'idle', 'requesting', 'resolved'
};

const SG_CENTER = { lat: 1.3048, lng: 103.8318 };

// --- SECURITY: CSV PARSING ---
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

// --- MATH: DISTANCE CALCULATION ---
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// --- GPS: UPDATED FOR INSTAGRAM STABILITY ---
async function getLocation() {
    // If we already have a location or are currently asking, don't trigger another prompt
    if (state.locationStatus === 'resolved' || state.locationStatus === 'requesting') {
        return state.userLoc || SG_CENTER;
    }
    
    state.locationStatus = 'requesting';

    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                state.locationStatus = 'resolved';
                resolve(state.userLoc);
            },
            (err) => {
                console.warn("Location denied or error. Using fallback.");
                state.userLoc = SG_CENTER;
                state.locationStatus = 'resolved'; // Mark as resolved so we stop asking
                resolve(SG_CENTER);
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: Infinity }
        );
    });
}

// --- ENGINE: CORE LOGIC ---
async function handleAction(category) {
    if (state.isLocating) return; 
    
    const resultsDiv = document.getElementById("results");
    
    // UI Setup
    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`${category}Btn`)?.classList.add('active');
    
    if (state.currentCategory !== category) {
        resultsDiv.innerHTML = document.getElementById('skeleton-template').innerHTML.repeat(2);
    }

    try {
        state.isLocating = true;

        // Run Location check and Data fetch at the same time
        const [userCoords, text] = await Promise.all([
            getLocation(),
            state.currentCategory !== category ? fetch(CONFIG.sheets[category]).then(r => r.text()) : Promise.resolve(null)
        ]);

        if (text) {
            state.currentCategory = category;
            state.dataCache = text.split("\n").slice(1)
                .map(row => ({ id: Math.random(), cols: secureParseCSV(row.trim()) }))
                .filter(item => item.cols.length >= 5);
            state.pointers[category] = 0; 
        }

        // Distance Sorting
        if (category !== 'music') {
            state.dataCache.forEach(item => {
                item.dist = calculateDistance(userCoords.lat, userCoords.lng, parseFloat(item.cols[2]), parseFloat(item.cols[3]));
            });
            if (state.pointers[category] === 0) state.dataCache.sort((a, b) => a.dist - b.dist);
        }

        // Render 2 items
        let selection = state.dataCache.slice(state.pointers[category], state.pointers[category] + 2);
        state.pointers[category] += 2;

        if (selection.length === 0) {
            resultsDiv.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;"><button onclick="resetList('${category}')" class="category-btn active">🔄 Start Over</button></div>`;
        } else {
            resultsDiv.innerHTML = "";
            selection.forEach(item => resultsDiv.appendChild(renderCard(item, category)));
        }

    } catch (e) {
        console.error(e);
    } finally {
        state.isLocating = false;
    }
}

// --- UI: RENDER CARD ---
function renderCard(item, category) {
    const [name, type, lat, lng, desc, musicUrl, mapsUrl] = item.cols;
    const distValue = (item.dist && item.dist < 1000) ? `${item.dist.toFixed(1)}km away` : "";
    
    const imagePool = {
        food: ["1555939594-58d7cb561ad1", "1540189549336-e6e99c3679fe", "1512621776951-a57141f2eefd"],
        store: ["1441986300917-64674bd600d8", "1472851294608-062f824d29cc"],
        music: ["1511671782779-c97d3d27a1d4", "1470225620780-dba8ba36b745"]
    };

    const pool = imagePool[category] || imagePool.food;
    const imgId = pool[item.id % pool.length];
    
    const card = document.createElement("div");
    card.className = "card";

    card.innerHTML = `
        <div class="img-container">
            <img src="https://images.unsplash.com/photo-${imgId}?auto=format&fit=crop&w=600&q=60" class="card-img" alt="">
            <span class="dist-tag"></span>
        </div>
        <div class="card-content">
            <span class="category-tag"></span>
            <h3></h3>
            <p></p>
            <div class="card-footer"></div>
        </div>`;

    card.querySelector('h3').textContent = name || "Unknown";
    card.querySelector('p').textContent = desc || "No description available.";
    card.querySelector('.category-tag').textContent = type || category;
    
    const distTag = card.querySelector('.dist-tag');
    if (distValue) {
        distTag.textContent = distValue;
    } else {
        distTag.remove();
    }
    
    const footer = card.querySelector('.card-footer');
    if (mapsUrl && category !== 'music') {
        const link = document.createElement('a');
        link.href = mapsUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "btn-link";
        link.textContent = "📍 Open Google Maps ↗";
        footer.appendChild(link);
    }
    if (musicUrl && category === 'music') {
        const link = document.createElement('a');
        link.href = musicUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "btn-link";
        link.textContent = "🎵 Open Spotify ↗";
        footer.appendChild(link);
    }

    return card;
}

// --- UTILITY: RESET POINTER ---
function resetList(cat) { 
    state.pointers[cat] = 0; 
    handleAction(cat); 
}

// --- INIT: AUTO-START ON LOAD ---
window.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('tutorial-overlay');
    const closeBtn = document.getElementById('close-tutorial');
    
    // THE FIX: Check if we are in "test mode" OR if it's the first visit
    const isTestMode = window.location.search.includes('test');
    const hasSeenTutorial = localStorage.getItem('sgVibesTutorialSeen');

    if (isTestMode || !hasSeenTutorial) {
        overlay.classList.remove('hidden');
    }

    closeBtn.addEventListener('click', () => {
        overlay.classList.add('hidden');
        localStorage.setItem('sgVibesTutorialSeen', 'true');
        // Clean the URL so the 'test' tag doesn't stay there forever
        if (isTestMode) window.history.replaceState({}, document.title, window.location.pathname);
    });

    // Start App
    handleAction('food');
});
