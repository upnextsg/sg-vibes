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
    pointers: { food: 0, store: 0, music: 0 } 
};

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


// Add isLocating to your state object at the top of your file
let state = { 
    userLoc: null, 
    currentCategory: null, 
    dataCache: [],
    pointers: { food: 0, store: 0, music: 0 },
    isLocating: false // NEW: Prevents app from moving forward until GPS is resolved
};
const SG_CENTER = { lat: 1.3048, lng: 103.8318 };

// --- GPS: THE ONCE-AND-FOR-ALL FIX ---
async function getLocation() {
    if (state.userLoc) return state.userLoc;
    
    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                resolve(state.userLoc);
            },
            (err) => {
                // If the user hits DENY, or if it genuinely times out, we use the fallback ONCE.
                console.warn("Location denied/failed:", err.message);
                state.userLoc = SG_CENTER; 
                resolve(SG_CENTER);
            }, 
            { 
                enableHighAccuracy: false, // Ensures fast response in WebViews
                timeout: 30000,            // Give the user 30 full seconds to deal with the popup
                maximumAge: Infinity 
            } 
        );
    });
}

// --- ENGINE: CORE LOGIC ---
async function handleAction(category) {
    // 1. Prevent overlapping clicks while waiting for the permission popup
    if (state.isLocating) return; 

    const resultsDiv = document.getElementById("results");
    const alertDiv = document.getElementById("distance-alert");
    const clickedBtn = document.getElementById(`${category}Btn`);
    
    // UI Update: Active Buttons
    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
    clickedBtn.classList.add('active');
    alertDiv.classList.add('hidden');

    // 2. Apply the "Loading Lock" visually if we don't have location yet
    let originalText = clickedBtn.innerHTML;
    if (!state.userLoc) {
        state.isLocating = true;
        clickedBtn.innerHTML = `<span class="icon">⏳</span> Waiting...`;
        resultsDiv.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: white; padding: 40px;">📍 Please click "Allow" on the location prompt...</div>`;
    }

    try {
        // 3. The app patiently waits here until the user clicks Allow/Deny.
        const userCoords = await getLocation();

        // Unlock the UI once we have an answer
        if (state.isLocating) {
            clickedBtn.innerHTML = originalText;
            state.isLocating = false;
        }

        // 4. Fetch data if category changed
        if (state.currentCategory !== category) {
            resultsDiv.innerHTML = document.getElementById('skeleton-template').innerHTML.repeat(2);
            state.currentCategory = category;
            
            const res = await fetch(CONFIG.sheets[category]);
            if (!res.ok) throw new Error("Fetch failed");
            const text = await res.text();
            
            state.dataCache = text.split("\n")
                .slice(1) 
                .map(row => row.trim())
                .filter(row => row.length > 10) 
                .map((row, idx) => ({ id: idx, cols: secureParseCSV(row) }))
                .filter(item => item.cols.length >= 5);
            
            state.pointers[category] = 0; 
        }

        // 5. Calculate distances securely
        if (userCoords && category !== 'music') {
            state.dataCache.forEach(item => {
                const lat = parseFloat(item.cols[2]);
                const lng = parseFloat(item.cols[3]);
                item.dist = (!isNaN(lat) && !isNaN(lng)) 
                    ? calculateDistance(userCoords.lat, userCoords.lng, lat, lng) : 9999;
            });

            if (state.pointers[category] === 0) {
                state.dataCache.sort((a, b) => a.dist - b.dist);
            }
        }

        // 6. Rendering Logic
        let currentIndex = state.pointers[category];
        if (currentIndex >= state.dataCache.length) {
            resultsDiv.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 40px;">
                    <p style="margin-bottom:15px; opacity:0.8; color:white;">✨ You've seen all current spots!</p>
                    <button onclick="resetList('${category}')" class="category-btn active" style="margin: 0 auto; width: auto; padding: 10px 20px;">🔄 Back to Start</button>
                </div>`;
            return; 
        }

        let selection = state.dataCache.slice(currentIndex, currentIndex + 2);
        state.pointers[category] += 2;

        // Boundary Alerts
        if (userCoords && category !== 'music') {
            const hasAnyNear = state.dataCache.some(item => item.dist <= 2);
            const currentItemsAreFar = selection.every(item => item.dist > 2);

            if (!hasAnyNear) {
                alertDiv.textContent = "📍 No options within 2km, showing others";
                alertDiv.classList.remove('hidden');
            } else if (currentItemsAreFar) {
                alertDiv.textContent = "📍 Nearby options cleared, showing further ones";
                alertDiv.classList.remove('hidden');
            }
        }

        // Draw Cards
        resultsDiv.innerHTML = "";
        selection.forEach(item => {
            if (item) resultsDiv.appendChild(renderCard(item, category));
        });

    } catch (err) {
        console.error(err);
        state.isLocating = false;
        clickedBtn.innerHTML = originalText;
        resultsDiv.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: white; padding: 20px;">❌ Error loading data. Please try again.</div>`;
    }
}

// --- UI: RENDER CARD ---
function renderCard(item, category) {
    const [name, type, lat, lng, desc, musicUrl, mapsUrl] = item.cols;
    const distValue = (item.dist && item.dist < 1000) ? `${item.dist.toFixed(1)}km away` : "";
    
    // Placeholder Images
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

    // Secure Text Injection
    card.querySelector('h3').textContent = name;
    card.querySelector('p').textContent = desc;
    card.querySelector('.category-tag').textContent = type;
    
    // Distance Tag
    const distTag = card.querySelector('.dist-tag');
    if (distValue) {
        distTag.textContent = distValue;
    } else {
        distTag.remove();
    }
    
    // External Links (Trust & Security)
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
    const resultsDiv = document.getElementById("results");
    
    // Do NOT call handleAction('food') here automatically anymore.
    // Instead, prompt the user to make the first move.
    resultsDiv.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 60px 20px;">
            <p style="font-size: 1.2rem; margin-bottom: 10px;">👋 Welcome!</p>
            <p style="font-size: 0.9rem; opacity: 0.8;">Tap a category above to find spots near you.</p>
        </div>`;
});
    
    // Automatically fetch and load the food category
    handleAction('food');
});
