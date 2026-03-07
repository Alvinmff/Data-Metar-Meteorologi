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

    if (data.raw) {
        const windMatch = data.raw.match(/(\d{3}|VRB)\d{2,3}(G\d{2,3})?KT/);
        if (windMatch) {
            updateWindChart(windMatch[0], true);
        }
    }

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
            flashUpdate(metarDisplay);
            
            if (isNewMetar) {
                typeWriterEffect(metarDisplay, data.raw);
            } else {
                metarDisplay.textContent = data.raw;
            }
            
            let statusClass = "";
            
            const thunderstormCodes = ["TS", "TSRA", "VCTS", "+TS", "TSGR"];
            const hasThunderstorm = thunderstormCodes.some(code => data.raw.includes(code));
            
            const visMatch = data.raw.match(/\s(\d{4})\s/);
            let vis = null;
            if (visMatch) {
                vis = parseInt(visMatch[1]);
            }
            
            const warningWeather = ["RA", "FG", "HZ", "BR", "SH", "DS", "SS", "FC"];
            const hasWarningWeather = warningWeather.some(code => data.raw.includes(code));
            
            if (hasThunderstorm || (vis && vis < 3000)) {
                statusClass = "status-danger";
            } else if (vis && vis >= 3000 && vis <= 5000) {
                statusClass = "status-warning";
            } else if (hasWarningWeather || data.raw.includes("+")) {
                statusClass = "status-warning";
            }
            
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

    if (data.wind) {
        updateWindChart(data.wind);
    }

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
        document.body.classList.add('low-visibility');
        playAlarm();
        lowVisTriggered = true;
    } else {
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
    // Destroy existing charts
    if (tempChart instanceof Chart) {
        tempChart.destroy();
    }
    if (pressureChart instanceof Chart) {
        pressureChart.destroy();
    }

    const tempCanvas = document.getElementById('tempChart');
    const pressureCanvas = document.getElementById('pressureChart');
    
    if (!tempCanvas || !pressureCanvas) {
        console.log("Chart canvases not found");
        return;
    }

    const ctxTemp = tempCanvas.getContext('2d');
    const ctxPressure = pressureCanvas.getContext('2d');

    tempChart = new Chart(ctxTemp, {
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

    pressureChart = new Chart(ctxPressure, {
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

        const windEl = document.getElementById("wind");
        const visEl = document.getElementById("visibility");
        const weatherEl = document.getElementById("weather");
        const cloudEl = document.getElementById("cloud");
        const qnhEl = document.getElementById("qnh");

        if (windEl) {
            flashUpdate(windEl);

            let windText = "--";

            if (data.wind) {
                windText = data.wind;
            } else if (data.wind_direction && data.wind_speed) {
                windText = data.wind_direction + "° " + data.wind_speed + " KT";

                if (data.wind_gust) {
                    windText += " G" + data.wind_gust;
                }
            }

            windEl.textContent = windText;
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
        updateWindChart(data.wind, false);
        updateWindRose(data.wind);

    } catch (error) {
        console.error("Error fetching METAR:", error);
    }
}

// =======================
// LOAD HISTORY FOR CHARTS
// =======================

async function loadHistory() {
    try {
        const response = await fetch("/api/metar/history");
        const result = await response.json();
        
        if (!result.data || result.data.length === 0) {
            console.log("No history data available");
            return;
        }

        const labels = [];
        const temps = [];
        const pressures = [];
        const winds = [];
        const gusts = [];

        result.data.forEach(row => {
            labels.push(row.time);
            temps.push(row.temp);
            pressures.push(row.pressure);
            winds.push(row.wind);
            gusts.push(row.gust);
        });

        // Ensure charts exist
        if (!tempChart || !pressureChart) {
            createCharts();
        }
        if (!windChart) {
            createWindChart();
        }

        // Populate Temperature Chart
        tempChart.data.labels = labels;
        tempChart.data.datasets[0].data = temps;

        // Populate Pressure Chart
        pressureChart.data.labels = labels;
        pressureChart.data.datasets[0].data = pressures;

        // Populate Wind Chart
        windChart.data.labels = labels;
        windChart.data.datasets[0].data = winds;
        windChart.data.datasets[1].data = gusts;

        // Update all charts
        tempChart.update();
        pressureChart.update();
        windChart.update();
        
        console.log("History loaded successfully");
    } catch (error) {
        console.error("Error loading history:", error);
    }
}

// =======================
// WEATHER ICON
// =======================

function updateWeatherIcon(weather) {
    const iconEl = document.getElementById("weather-icon");
    if (!iconEl) return;
    
    let icon = "☀️";

    if (weather && weather.includes("TS")) icon = "⛈️";
    else if (weather && weather.includes("RA")) icon = "🌧️";
    else if (weather && weather.includes("FG")) icon = "🌫️";
    else if (weather && weather.includes("HZ")) icon = "🌤️";
    else if (weather && weather.includes("SN")) icon = "❄️";
    else if (weather && weather.includes("DU")) icon = "🌪️";
    else if (weather && weather.includes("SQ")) icon = "💨";

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
function createWindChart() {
    const windCanvas = document.getElementById('windChart');
    if (!windCanvas) return;
    
    const ctx = windCanvas.getContext('2d');

    windChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Wind Speed (KT)',
                    data: [],
                    borderColor: '#FFD60A',
                    backgroundColor: 'rgba(255,214,10,0.20)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#FFD60A',    // titik kuning
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2
                },
                {
                    label: 'Wind Gust (KT)',
                    data: [],
                    borderColor: '#003a1c',
                    backgroundColor: 'rgba(67, 215, 18, 0.1)',
                    borderWidth: 3,
                    borderDash: [5,5],
                    tension: 0.4,
                    fill: true,
                    spanGaps: true, // ⭐ ini yang memperbaiki garis putus
                    pointRadius: 4,
                    pointHoverRadius: 5,
                    pointBackgroundColor: '#003a1c',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2,
                    hidden: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            animation: {
                duration: 800,
                easing: 'easeOutQuart'
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        font: { weight: 'bold' },
                        color: '#0c4a6e',
                        usePointStyle: true,
                        padding: 20
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(12, 74, 110, 0.9)',
                    titleFont: { size: 14, weight: 'bold' },
                    bodyFont: { size: 13 },
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ": " + context.raw + " kt";
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(54, 162, 235, 0.1)'
                    },
                    ticks: {
                        color: '#64748b',
                        font: { weight: 'bold' }
                    },
                    title: {
                        display: true,
                        text: 'Speed (KT)',
                        color: '#0c4a6e',
                        font: { weight: 'bold' }
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

// Update wind chart from wind text
function updateWindChart(windText, isRealtime = true) {
    if (!isRealtime) return;
    if (!windText || !windText.includes("KT")) return;
    
    let speed = 0;
    let gust = null;
    
    const match = windText.match(/(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?KT/);
    if (match) {
        speed = parseInt(match[2]);
        if (match[4]) {
            gust = parseInt(match[4]);
        }
    }
    
    // Create chart if not exists
    if (!windChart) {
        createWindChart();
    }
    
    const now = new Date();
    const timeLabel = now.getHours().toString().padStart(2, '0') + ':' + 
                      now.getMinutes().toString().padStart(2, '0');
    
    windChart.data.labels.push(timeLabel);
    windChart.data.datasets[0].data.push(speed || 0);
    windChart.data.datasets[1].data.push(gust || null);

    if (windChart.data.labels.length > 15) {
        windChart.data.labels.shift();
        windChart.data.datasets[0].data.shift();
        windChart.data.datasets[1].data.shift();
    }

    windChart.update();
}

// =======================
// WIND ROSE - Using Chart.js PolarArea
// =======================

function updateWindRose(windText) {
    if (!windText || !windText.includes("°")) return;
    
    const direction = parseInt(windText.split("°")[0]) || 0;

    if (!windRose) {
        const roseCanvas = document.getElementById('windRose');
        if (!roseCanvas) return;
        
        const ctx = roseCanvas.getContext('2d');
        windRose = new Chart(ctx, {
            type: 'polarArea',
            data: {
                labels: ['N','NE','E','SE','S','SW','W','NW'],
                datasets: [{
                    data: [0,0,0,0,0,0,0,0],
                    backgroundColor: [
                        'rgba(239, 68, 68, 0.7)',
                        'rgba(249, 115, 22, 0.7)',
                        'rgba(234, 179, 8, 0.7)',
                        'rgba(34, 197, 94, 0.7)',
                        'rgba(6, 182, 212, 0.7)',
                        'rgba(59, 130, 246, 0.7)',
                        'rgba(139, 92, 246, 0.7)',
                        'rgba(236, 72, 153, 0.7)'
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
            if (document.getElementById("status-indicator")) {
                const statusEl = document.getElementById("status-indicator");
                statusEl.innerHTML = "<span class='online-dot'></span> ONLINE";
                statusEl.style.transform = 'scale(1.1)';
                setTimeout(() => statusEl.style.transform = 'scale(1)', 200);
            }

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
            
            const alertBox = document.getElementById("alert-box");
            
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

            if (data.thunderstorm === true) {
                const sound = document.getElementById("lowVisSound");
                if (sound) sound.play();
                if (alertBox) {
                    alertBox.innerHTML = "🌩️ THUNDERSTORM DETECTED";
                    alertBox.classList.add("alert-danger");
                    alertBox.style.display = 'block';
                }
            }

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
// WIND COMPASS - Real-Time Wind Direction (Using Plotly)
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
// WIND ROSE - Historical Wind Data (Using Plotly)
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
                    showgrid: false,
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

        Plotly.newPlot("windRoseChart", [trace], layout, {responsive: true});
    })
    .catch(error => {
        console.error("Error loading Wind Rose:", error);
    });
}

// Auto-refresh
setInterval(loadWindCompass, 5000);
setInterval(loadWindRose, 10000);

// =======================
// INITIALIZATION
// =======================

document.addEventListener("DOMContentLoaded", function() {
    // Initial card animations
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

    // Create all charts
    createCharts();
    createWindChart();
    
    // Update charts
    updateCharts();
    loadHistory();
    loadWindRose();
    loadWindCompass();

    if (typeof STATION !== 'undefined' && STATION) {
        fetchMetar();
    }

    // Auto refresh METAR every minute
    setInterval(fetchMetar, 60000);

    // Table row animations
    const tableRows = document.querySelectorAll('#historyTableBody tr');
    tableRows.forEach((row, index) => {
        row.style.opacity = '0';
        row.style.animation = `fadeInUp 0.4s ease-out ${index * 0.05}s both`;
    });

    // Button click animations
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

// Add CSS animations dynamically
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

