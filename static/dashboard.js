let tempChart;
let pressureChart;
let windChart = null;
let windRose = null;
let lastTimestamp = null;
let lastMetarRaw = null;
let lowVisTriggered = false;
let soundEnabled = false;

const socket = io();

// =======================
// ANIMATION UTILITIES
// =======================

function animateValue(element, oldValue, newValue, duration = 500) {
    if (!element) return;
    
    const startTimestamp = performance.now();
    const start = parseFloat(oldValue) || 0;
    const end = parseFloat(newValue);
    
    const step = (timestamp) => {
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const value = start + (end - start) * easeOutQuart(progress);
        element.textContent = formatValue(value);
        
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    
    window.requestAnimationFrame(step);
}

function easeOutQuart(x) {
    return 1 - Math.pow(1 - x, 4);
}

function formatValue(val) {
    if (Number.isInteger(val)) return val.toString();
    return val.toFixed(1);
}

function addPulseAnimation(element) {
    if (!element) return;
    element.classList.add('pulse-animation');
    setTimeout(() => element.classList.remove('pulse-animation'), 600);
}

function flashUpdate(element) {
    if (!element) return;
    element.classList.add('data-updated');
    setTimeout(() => element.classList.remove('data-updated'), 600);
}

// =======================
// COPY QAM TO CLIPBOARD
// =======================
function copyQamToClipboard() {
    const qamElement = document.getElementById('qamDisplay');
    const qamText = qamElement.innerText;
    navigator.clipboard.writeText(qamText).then(function() {
        const feedback = document.getElementById('copyFeedback');
        if (feedback) {
            feedback.classList.add('visible');
            setTimeout(function() {
                feedback.classList.remove('visible');
            }, 2000);
        }
    }).catch(function(err) {
        console.error('Gagal menyalin teks: ', err);
    });
}

window.copyQamToClipboard = copyQamToClipboard;

// =======================
// SOCKET CONNECTION
// =======================

socket.on("connect", () => {
    console.log("Connected to WebSocket");
    const statusEl = document.getElementById("status-indicator");
    if (statusEl) {
        statusEl.innerHTML = "<span class='online-dot'></span> LIVE";
        statusEl.style.animation = "none";
        setTimeout(() => statusEl.style.animation = "", 10);
    }
});

socket.on("disconnect", () => {
    const statusEl = document.getElementById("status-indicator");
    if (statusEl) {
        statusEl.innerHTML = "<span class='offline-dot'></span> OFFLINE";
    }
});

// =======================
// METAR UPDATE HANDLER
// =======================

socket.on("metar_update", function(data) {
    console.log("New METAR received:", data);

    if (!data.raw) return;

    const newRaw = data.raw;

    // Check if data is actually new
    if (lastMetarRaw && lastMetarRaw === newRaw) {
        return;
    }

    const isNewMetar = lastMetarRaw !== null;
    lastMetarRaw = newRaw;

    // === ANIMATE QAM UPDATE ===
    if (data.qam) {
        const qamEl = document.getElementById("qamDisplay");
        if (qamEl) {
            qamEl.style.opacity = '0.5';
            qamEl.textContent = data.qam;
            setTimeout(() => qamEl.style.opacity = '1', 200);
        }
    }

    // === ANIMATE NARRATIVE UPDATE ===
    if (data.narrative) {
        const narrativeEl = document.getElementById("narrativeDisplay");
        if (narrativeEl) {
            narrativeEl.style.transform = 'translateX(-10px)';
            narrativeEl.style.opacity = '0.5';
            narrativeEl.textContent = data.narrative;
            setTimeout(() => {
                narrativeEl.style.transform = 'translateX(0)';
                narrativeEl.style.opacity = '1';
            }, 200);
        }
    }

    // === UPDATE METAR DISPLAY WITH ANIMATION ===
    if (data.raw) {
        const metarDisplay = document.querySelector(".metar-display");
        if (metarDisplay) {
            // Flash animation for update
            flashUpdate(metarDisplay);
            
            // Typewriter effect for new METAR
            if (isNewMetar) {
                typeWriterEffect(metarDisplay, data.raw);
            } else {
                metarDisplay.textContent = data.raw;
            }
            
            // Update status color class based on conditions
            let statusClass = "";
            
            // Check for thunderstorm
            const thunderstormCodes = ["TS", "TSRA", "VCTS", "+TS", "TSGR"];
            const hasThunderstorm = thunderstormCodes.some(code => data.raw.includes(code));
            
            // Check visibility
            const visMatch = data.raw.match(/\s(\d{4})\s/);
            let vis = null;
            if (visMatch) {
                vis = parseInt(visMatch[1]);
            }
            
            // Check for warning weather
            const warningWeather = ["RA", "FG", "HZ", "BR", "SH", "DS", "SS", "FC"];
            const hasWarningWeather = warningWeather.some(code => data.raw.includes(code));
            
            // Determine status
            if (hasThunderstorm || (vis && vis < 3000)) {
                statusClass = "status-danger";
            } else if (vis && vis >= 3000 && vis <= 5000) {
                statusClass = "status-warning";
            } else if (hasWarningWeather || data.raw.includes("+")) {
                statusClass = "status-warning";
            }
            
            // Remove old status classes and add new one
            metarDisplay.classList.remove("status-danger", "status-warning");
            if (statusClass) {
                metarDisplay.classList.add(statusClass);
            }
        }
    }

    // === UPDATE TIMESTAMP ===
    const now = new Date();
    const formatted = 
        now.getDate().toString().padStart(2,'0') + "-" +
        (now.getMonth()+1).toString().padStart(2,'0') + "-" +
        now.getFullYear() + " " +
        now.getHours().toString().padStart(2,'0') + ":" +
        now.getMinutes().toString().padStart(2,'0') + ":" +
        now.getSeconds().toString().padStart(2,'0');

    const lastUpdateEl = document.getElementById("lastUpdate");
    if (lastUpdateEl) {
        lastUpdateEl.style.transform = 'scale(1.05)';
        lastUpdateEl.innerText = "Last Update: " + formatted;
        setTimeout(() => lastUpdateEl.style.transform = 'scale(1)', 300);
    }

    const lastSavedEl = document.getElementById("lastSaved");
    if (lastSavedEl) {
        lastSavedEl.innerText = formatted;
    }

    // === UPDATE CHARTS ===
    updateCharts();
    
    // === UPDATE HISTORY TABLE ===
    updateHistoryTable();

    // ===============================
    // VISIBILITY CHECK & ALARM
    // ===============================
    const visMatch = newRaw.match(/\s(\d{4})\s/);
    let vis = null;

    if (visMatch) {
        vis = parseInt(visMatch[1]);
    }

    if (vis && vis < 3000) {
        // 🔴 LOW VISIBILITY → ALARM
        document.body.classList.add('low-visibility');
        playAlarm();
        lowVisTriggered = true;
    } else {
        // 🟢 NORMAL VIS → NOTIFY
        document.body.classList.remove('low-visibility');
        playNotify();
        lowVisTriggered = false;
    }
});

// Typewriter effect function
function typeWriterEffect(element, text, speed = 30) {
    element.textContent = '';
    let i = 0;
    
    function type() {
        if (i < text.length) {
            element.textContent += text.charAt(i);
            i++;
            setTimeout(type, speed);
        }
    }
    
    type();
}

// =======================
// HISTORY TABLE UPDATE
// =======================

async function updateHistoryTable() {
    try {
        const response = await fetch("/api/history");
        const result = await response.json();
        
        const tableBody = document.getElementById("historyTableBody");
        if (!tableBody) return;
        
        // Fade out
        tableBody.style.opacity = '0.5';
        
        setTimeout(async () => {
            tableBody.innerHTML = "";
            
            if (result.data && result.data.length > 0) {
                result.data.forEach((item, index) => {
                    const row = document.createElement("tr");
                    row.style.animation = `fadeInUp 0.3s ease-out ${index * 0.05}s both`;
                    
                    const timeCell = document.createElement("td");
                    timeCell.textContent = item.time;
                    
                    const stationCell = document.createElement("td");
                    stationCell.textContent = item.station;
                    
                    const metarCell = document.createElement("td");
                    metarCell.textContent = item.metar;
                    
                    row.appendChild(timeCell);
                    row.appendChild(stationCell);
                    row.appendChild(metarCell);
                    
                    tableBody.appendChild(row);
                });
            } else {
                tableBody.innerHTML = '<tr><td colspan="3" class="text-center">No data available</td></tr>';
            }
            
            // Fade in
            tableBody.style.opacity = '1';
        }, 200);
        
    } catch (error) {
        console.error("Error updating history table:", error);
    }
}

// =======================
// CHARTS CREATION
// =======================

function createCharts() {
    // Temperature Chart
    tempChart = new Chart(document.getElementById("tempChart"), {
        type: "line",
        data: { 
            labels: [], 
            datasets: [{ 
                label: "Temperature (°C)", 
                data: [],
                borderColor: "rgba(239, 68, 68, 1)",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6,
                pointBackgroundColor: "rgba(239, 68, 68, 1)"
            }] 
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 800,
                easing: 'easeOutQuart'
            },
            plugins: {
                legend: {
                    labels: {
                        font: { weight: 'bold' }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: {
                        color: 'rgba(14, 165, 233, 0.1)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });

    // Pressure Chart
    pressureChart = new Chart(document.getElementById("pressureChart"), {
        type: "line",
        data: { 
            labels: [], 
            datasets: [{ 
                label: "Pressure (QNH)", 
                data: [],
                borderColor: "rgba(14, 165, 233, 1)",
                backgroundColor: "rgba(14, 165, 233, 0.15)",
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6,
                pointBackgroundColor: "rgba(14, 165, 233, 1)"
            }] 
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 800,
                easing: 'easeOutQuart'
            },
            plugins: {
                legend: {
                    labels: {
                        font: { weight: 'bold' }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: {
                        color: 'rgba(14, 165, 233, 0.1)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// =======================
// FETCH METAR DATA
// =======================

async function fetchMetar() {
    try {
        const response = await fetch(`/api/metar/${STATION}`);
        const data = await response.json();

        if (data.error) return;

        // Animate value updates
        const windEl = document.getElementById("wind");
        const visEl = document.getElementById("visibility");
        const weatherEl = document.getElementById("weather");
        const cloudEl = document.getElementById("cloud");
        const qnhEl = document.getElementById("qnh");

        if (windEl) {
            const oldWind = windEl.textContent;
            flashUpdate(windEl);
            windEl.textContent = data.wind;
        }
        if (visEl) {
            flashUpdate(visEl);
            visEl.textContent = data.visibility;
        }
        if (weatherEl) {
            flashUpdate(weatherEl);
            weatherEl.textContent = data.weather;
        }
        if (cloudEl) {
            flashUpdate(cloudEl);
            cloudEl.textContent = data.cloud;
        }
        if (qnhEl) {
            flashUpdate(qnhEl);
            qnhEl.textContent = data.qnh + " MB";
        }

        updateWeatherIcon(data.weather);
        updateWindChart(data.wind);
        updateWindRose(data.wind);

    } catch (error) {
        console.error("Error fetching METAR:", error);
    }
}

// =======================
// WEATHER ICON
// =======================

function updateWeatherIcon(weather) {
    const iconEl = document.getElementById("weather-icon");
    if (!iconEl) return;
    
    let icon = "☀️";

    if (weather.includes("TS")) icon = "⛈️";
    else if (weather.includes("RA")) icon = "🌧️";
    else if (weather.includes("FG")) icon = "🌫️";
    else if (weather.includes("HZ")) icon = "🌤️";
    else if (weather.includes("SN")) icon = "❄️";
    else if (weather.includes("DU")) icon = "🌪️";
    else if (weather.includes("SQ")) icon = "💨";

    // Animate icon change
    iconEl.style.transform = 'scale(0) rotate(-180deg)';
    setTimeout(() => {
        iconEl.textContent = icon;
        iconEl.style.transform = 'scale(1) rotate(0deg)';
    }, 150);
    
    iconEl.style.transition = 'transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)';
}

// =======================
// WIND SPEED CHART
// =======================

function updateWindChart(windText) {
    const speed = parseInt(windText.split("/")[1]) || 0;

    if (!windChart) {
        const ctx = document.getElementById('windChart').getContext('2d');
        windChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Wind Speed (KT)',
                    backgroundColor: 'rgba(245, 158, 11, 0.2)',
                    borderColor: 'rgba(245, 158, 11, 1)',
                    borderWidth: 4,
                    data: [],
                    tension: 0.4,
                    fill: false,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBackgroundColor: 'rgba(245, 158, 11, 1)',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    showLine: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 800,
                    easing: 'easeOutQuart'
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            font: { weight: 'bold' },
                            color: '#0c4a6e'
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(245, 158, 11, 0.1)'
                        },
                        ticks: {
                            color: '#64748b'
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            color: '#64748b',
                            maxTicksLimit: 8
                        }
                    }
                }
            }
        });
    }

    windChart.data.labels.push(new Date().toLocaleTimeString());
    windChart.data.datasets[0].data.push(speed);

    if (windChart.data.labels.length > 15) {
        windChart.data.labels.shift();
        windChart.data.datasets[0].data.shift();
    }

    windChart.update();
}

// =======================
// WIND ROSE - RAINBOW COLORS
// =======================

function updateWindRose(windText) {
    const direction = parseInt(windText.split("°")[0]) || 0;

    if (!windRose) {
        const ctx = document.getElementById('windRose').getContext('2d');
        windRose = new Chart(ctx, {
            type: 'polarArea',
            data: {
                labels: ['N','NE','E','SE','S','SW','W','NW'],
                datasets: [{
                    data: [0,0,0,0,0,0,0,0],
                    // Rainbow colors for each direction
                    backgroundColor: [
                        'rgba(239, 68, 68, 0.7)',    // N - Red
                        'rgba(249, 115, 22, 0.7)',   // NE - Orange
                        'rgba(234, 179, 8, 0.7)',    // E - Yellow
                        'rgba(34, 197, 94, 0.7)',    // SE - Green
                        'rgba(6, 182, 212, 0.7)',    // S - Cyan
                        'rgba(59, 130, 246, 0.7)',   // SW - Blue
                        'rgba(139, 92, 246, 0.7)',   // W - Indigo
                        'rgba(236, 72, 153, 0.7)'    // NW - Violet/Pink
                    ],
                    borderColor: [
                        'rgba(239, 68, 68, 1)',
                        'rgba(249, 115, 22, 1)',
                        'rgba(234, 179, 8, 1)',
                        'rgba(34, 197, 94, 1)',
                        'rgba(6, 182, 212, 1)',
                        'rgba(59, 130, 246, 1)',
                        'rgba(139, 92, 246, 1)',
                        'rgba(236, 72, 153, 1)'
                    ],
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 800,
                    easing: 'easeOutQuart'
                },
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            font: { weight: 'bold', size: 12 },
                            color: '#0c4a6e',
                            padding: 15
                        }
                    }
                },
                scales: {
                    r: {
                        grid: {
                            color: 'rgba(14, 165, 233, 0.2)'
                        },
                        ticks: {
                            color: '#64748b',
                            backdropColor: 'transparent'
                        }
                    }
                }
            }
        });
    }

    const index = Math.floor(direction / 45) % 8;
    windRose.data.datasets[0].data[index] += 1;
    windRose.update();
}

// =======================
// FULLSCREEN TOGGLE
// =======================

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
        document.body.classList.add("atc-mode");
    } else {
        document.exitFullscreen();
        document.body.classList.remove("atc-mode");
    }
}

window.toggleFullscreen = toggleFullscreen;

// =======================
// UPDATE CHARTS FROM API
// =======================

function updateCharts() {
    fetch("/api/latest")
        .then(response => response.json())
        .then(data => {
            // ONLINE INDICATOR
            if (document.getElementById("status-indicator")) {
                const statusEl = document.getElementById("status-indicator");
                statusEl.innerHTML = "<span class='online-dot'></span> ONLINE";
                statusEl.style.transform = 'scale(1.1)';
                setTimeout(() => statusEl.style.transform = 'scale(1)', 200);
            }

            // UPDATE CHART
            if (tempChart) {
                tempChart.data.labels = data.labels;
                tempChart.data.datasets[0].data = data.temps;
                tempChart.update('none');
            }

            if (pressureChart) {
                pressureChart.data.labels = data.labels;
                pressureChart.data.datasets[0].data = data.pressures;
                pressureChart.update('none');
            }
            
            // Get alertBox element
            const alertBox = document.getElementById("alert-box");
            
            // Alert crosswind
            if (data.crosswind > 20) {
                if (alertBox) {
                    alertBox.innerHTML = "🚨 CROSSWIND CRITICAL";
                    alertBox.classList.add("alert-danger");
                    alertBox.style.display = 'block';
                }
            } else {
                if (alertBox) {
                    alertBox.style.display = 'none';
                    alertBox.classList.remove("alert-danger");
                }
            }   

            // Alert thunderstorm
            if (data.thunderstorm === true) {
                const sound = document.getElementById("lowVisSound");
                if (sound) sound.play();
                if (alertBox) {
                    alertBox.innerHTML = "🌩️ THUNDERSTORM DETECTED";
                    alertBox.classList.add("alert-danger");
                    alertBox.style.display = 'block';
                }
            }

            // NEW DATA ALERT (WARR)
            const latestTimestamp = data.timestamp;
            if (lastTimestamp && latestTimestamp !== lastTimestamp) {
                const notifySound = document.getElementById("newDataSound");
                if (notifySound) notifySound.play();
            }
            lastTimestamp = latestTimestamp;
        })
        .catch(error => console.error("Update error:", error));
}

// =======================
// SOUND FUNCTIONS
// =======================

function enableSound() {
    soundEnabled = true;

    const audio1 = document.getElementById("lowVisSound");
    const audio2 = document.getElementById("newDataSound");

    if (audio1) audio1.play().then(() => audio1.pause());
    if (audio2) audio2.play().then(() => audio2.pause());

    // Update button appearance
    const btn = document.querySelector('.btn-warning');
    if (btn) {
        btn.textContent = '🔊 Sound Enabled';
        btn.style.background = 'linear-gradient(135deg, #22c55e, #4ade80) !important';
    }
    
    console.log("Sound system armed.");
}

window.enableSound = enableSound;

function playAlarm() {
    if (!soundEnabled) return;

    const alarmAudio = document.getElementById("lowVisSound");
    if (alarmAudio) {
        alarmAudio.currentTime = 0;
        alarmAudio.play().catch(e => console.error(e));
    }
}

function playNotify() {
    if (!soundEnabled) return;

    const notifyAudio = document.getElementById("newDataSound");
    if (notifyAudio) {
        notifyAudio.currentTime = 0;
        notifyAudio.play().catch(e => console.error(e));
    }
}

// =======================
// INITIALIZATION
// =======================

// =======================
// WIND COMPASS - Real-Time Wind Direction
// =======================
function loadWindCompass() {
    fetch(`/api/metar/${STATION}`)
    .then(res => res.json())
    .then(data => {
        if (data.error || !data.wind_direction) {
            console.log("No wind data available for compass");
            return;
        }

        let windDir = parseInt(data.wind_direction);
        let windSpeed = data.wind_speed || 0;

        // Handle VRB (variable) wind
        if (data.wind_direction === "VRB") {
            windDir = 0;
        }

        let trace = {
            type: "scatterpolar",
            r: [0, 1],
            theta: [0, windDir],
            mode: "lines+markers",
            line: {
                color: "red",
                width: 4
            },
            marker: {
                size: 10,
                color: "red"
            },
            fill: "toself",
            fillcolor: "rgba(239, 68, 68, 0.2)"
        };

        let layout = {
            polar: {
                bgcolor: 'rgba(0,0,0,0)',
                angularaxis: {
                    direction: "clockwise",
                    rotation: 90,
                    tickmode: "array",
                    tickvals: [0, 45, 90, 135, 180, 225, 270, 315],
                    ticktext: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
                    tickfont: { size: 14, color: '#0c4a6e', weight: 'bold' }
                },
                radialaxis: {
                    visible: false
                }
            },
            showlegend: false,
            margin: { t: 30, b: 30, l: 30, r: 30 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            annotations: [{
                text: `<b>${windDir}°</b><br>${windSpeed} kt`,
                showarrow: false,
                font: {
                    size: 24,
                    color: '#0c4a6e',
                    weight: 'bold'
                },
                y: 0.5,
                x: 0.5,
                xref: 'paper',
                yref: 'paper'
            }]
        };

        Plotly.newPlot("windCompassChart", [trace], layout, {responsive: true});
    })
    .catch(error => {
        console.error("Error loading Wind Compass:", error);
    });
}

// =======================
// WIND ROSE - Historical Wind Data (Without Grid Lines)
// =======================
function loadWindRose() {
    fetch(`/api/windrose/${STATION}`)
    .then(res => res.json())
    .then(data => {
        if (!data || data.length === 0) {
            console.log("No wind history data available");
            return;
        }

        let directions = data.map(d => d.dir);
        let speeds = data.map(d => d.speed);

        // Create barpolar trace for Wind Rose
        let trace = {
            type: "barpolar",
            r: speeds,
            theta: directions,
            marker: {
                color: speeds,
                colorscale: "Viridis",
                showscale: true,
                colorbar: {
                    title: "Speed (kt)",
                    thickness: 15,
                    len: 0.5
                }
            },
            opacity: 0.85
        };

        let layout = {
            polar: {
                bgcolor: 'rgba(0,0,0,0)',
                angularaxis: {
                    direction: "clockwise",
                    rotation: 90,
                    tickmode: "array",
                    tickvals: [0, 45, 90, 135, 180, 225, 270, 315],
                    ticktext: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
                    tickfont: { size: 12, color: '#0c4a6e' }
                },
                radialaxis: {
                    showgrid: false,   // ❌ hapus garis lingkaran
                    ticks: '',
                    showline: false,
                    visible: false
                }
            },
            showlegend: false,
            margin: { t: 20, b: 40, l: 40, r: 40 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)'
        };

        // Use the new chart element
        Plotly.newPlot("windRoseChartNew", [trace], layout, {responsive: true});
    })
    .catch(error => {
        console.error("Error loading Wind Rose:", error);
    });
}

// Auto-refresh Wind Compass every 5 seconds
setInterval(loadWindCompass, 5000);

// Auto-refresh Wind Rose every 10 seconds
setInterval(loadWindRose, 10000);

document.addEventListener("DOMContentLoaded", function() {
    // Initial animations
    const cards = document.querySelectorAll('.card-custom');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        setTimeout(() => {
            card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, 100 + (index * 100));
    });

    // Create and update charts
    createCharts();
    updateCharts();
    
    // Load Wind Rose and Wind Compass from historical data
    loadWindRose();
    loadWindCompass();

    if (typeof STATION !== 'undefined' && STATION) {
        fetchMetar();
    }

    // Add stagger animation to table rows
    const tableRows = document.querySelectorAll('#historyTableBody tr');
    tableRows.forEach((row, index) => {
        row.style.opacity = '0';
        row.style.animation = `fadeInUp 0.4s ease-out ${index * 0.05}s both`;
    });

    // Add click animation to buttons
    const buttons = document.querySelectorAll('button, .nav-btn, .btn-secondary-custom');
    buttons.forEach(btn => {
        btn.addEventListener('click', function(e) {
            const ripple = document.createElement('span');
            ripple.style.cssText = `
                position: absolute;
                background: rgba(255,255,255,0.5);
                border-radius: 50%;
                transform: scale(0);
                animation: rippleEffect 0.6s linear;
                pointer-events: none;
            `;
            this.style.position = 'relative';
            this.style.overflow = 'hidden';
            this.appendChild(ripple);
            setTimeout(() => ripple.remove(), 600);
        });
    });
});

// Add ripple animation dynamically
const style = document.createElement('style');
style.textContent = `
    @keyframes rippleEffect {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
    
    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    .pulse-animation {
        animation: pulse 0.6s ease-in-out;
    }
    
    @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
    }
    
    .data-updated {
        animation: dataFlash 0.6s ease-out;
    }
    
    @keyframes dataFlash {
        0% { transform: scale(1.02); background: rgba(14, 165, 233, 0.2); }
        100% { transform: scale(1); background: transparent; }
    }
`;
document.head.appendChild(style);
