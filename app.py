from flask import Flask, render_template, request, send_file
import requests
import pandas as pd
import os
import re
import io   
from flask import jsonify
from datetime import datetime
from datetime import timedelta
from io import BytesIO
from flask_socketio import SocketIO
import time
import threading
from collections import deque


app = Flask(__name__)
socketio = SocketIO(app, async_mode="threading")

CSV_FILE = "metar_history.csv"

# Wind history storage for Wind Rose
wind_history = deque(maxlen=500)

# Store wind data for Wind Rose
def store_wind(parsed):
    if parsed["wind_dir"] and parsed["wind_speed_kt"]:
        wind_history.append({
            "time": datetime.utcnow(),
            "dir": int(parsed["wind_dir"]),
            "speed": float(parsed["wind_speed_kt"])
        })
        print(f"[WIND] Stored: dir={parsed['wind_dir']}, speed={parsed['wind_speed_kt']} kt")


FONNTE_TOKEN = "iNQh3nXPgRFpShmXvZb4"
WA_TARGET = ""  # nomor tujuan (format 62 tanpa +)

def send_whatsapp_message(message):
    url = "https://api.fonnte.com/send"

    headers = {
        "Authorization": FONNTE_TOKEN
    }

    data = {
        "target": WA_TARGET,
        "message": message
    }

    response = requests.post(url, headers=headers, data=data)
    return response.status_code

import math

def calculate_crosswind(wind_dir, wind_speed, runway_heading):
    angle = abs(wind_dir - runway_heading)
    angle_rad = math.radians(angle)
    return round(wind_speed * math.sin(angle_rad), 1)


#Deteksi thunderstorm dari raw METAR
def detect_thunderstorm(raw_metar):
    ts_codes = ["TS", "TSRA", "VCTS", "+TS", "TSGR", "-TS", "TSRA", "+TSRA", "-TSRA"]
    return any(code in raw_metar for code in ts_codes)


# =========================
# GET METAR FROM NOAA
# =========================
def get_metar(station_code):
    # Headers to mimic browser request
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    }
    
    # Try primary NOAA source
    url = f"https://tgftp.nws.noaa.gov/data/observations/metar/stations/{station_code.upper()}.TXT"
    print(f"[DEBUG] Fetching METAR from: {url}")
    
    try:
        response = requests.get(url, timeout=15, headers=headers)
        print(f"[DEBUG] Response status: {response.status_code}")
        if response.status_code == 200:
            lines = response.text.strip().split("\n")
            print(f"[DEBUG] Raw response lines: {lines}")
            
            # Find the METAR line (usually the last line that starts with station code)
            for line in lines:
                line = line.strip()
                if line and line.startswith(station_code.upper()):
                    print(f"[DEBUG] METAR retrieved: {line}")
                    return line
            
            # Fallback: if no line starts with station, take last non-empty line
            for line in reversed(lines):
                line = line.strip()
                if line:
                    print(f"[DEBUG] METAR retrieved (fallback): {line}")
                    return line
                    
    except requests.exceptions.Timeout:
        print("[ERROR] Request timeout while fetching METAR from NOAA")
    except requests.exceptions.ConnectionError as e:
        print(f"[ERROR] Connection error while fetching METAR from NOAA: {e}")
    except Exception as e:
        print(f"[ERROR] Exception while fetching METAR from NOAA: {e}")
    
    # Try alternative source - AVWX (backup)
    print("[DEBUG] Trying alternative METAR source...")
    alt_url = f"https://avwx.rest/api/metar/{station_code.upper()}"
    try:
        response = requests.get(alt_url, timeout=15, headers=headers)
        if response.status_code == 200:
            data = response.json()
            if "raw" in data:
                metar = data["raw"]
                print(f"[DEBUG] METAR from alternative source: {metar}")
                return metar
    except Exception as e:
        print(f"[DEBUG] Alternative source also failed: {e}")
    
    print("[ERROR] All METAR sources failed!")
    return None

# =========================
# WEATHER CODES
# =========================
WEATHER_CODES = [
    "DZ", "-RA", "RA","SN","SG","IC","PL","GR","GS",
    "UP","BR","FG","FU","VA","DU","SA","HZ",
    "PO","SQ","FC","SS","DS","TS","SH", "TSRA",
    "+TSRA", "-TSRA", "-TS", "+TS"
]

# =========================
# PARSE METAR
# =========================
def parse_metar(metar):

    data = {
        "station": None,
        "day": None,
        "hour": None,
        "minute": None,
        "wind_dir": None,
        "wind_speed_kt": None,
        "wind_gust_kt": None,
        "visibility_m": None,
        "weather": None,
        "cloud": None,
        "temperature_c": None,
        "dewpoint_c": None,
        "pressure_hpa": None,
        "trend": None,
        "tempo": None  # Add tempo field
    }

    clean_metar = metar.replace("=", "")
    parts = clean_metar.split()

    # First, extract TEMPO clause before the main parsing
    # This removes TEMPO from METAR so weather isn't captured from TEMPO section
    tempo_match = re.search(r'TEMPO\s+(.+)', metar)
    if tempo_match:
        tempo_content = tempo_match.group(1).strip()
        # Store the full TEMPO content
        data["tempo"] = tempo_content
        # Remove TEMPO clause from METAR for parsing (to avoid capturing weather from TEMPO)
        main_metar = re.sub(r'\s+TEMPO\s+.+', '', metar)
    else:
        main_metar = metar
    
    # Parse the main METAR (without TEMPO) for weather and other fields
    parts = main_metar.replace("=", "").split()

    for part in parts:

        if len(part) == 4 and part.isalpha() and data["station"] is None:
            data["station"] = part

        if part.endswith("Z") and len(part) == 7:
            data["day"] = part[0:2]
            data["hour"] = part[2:4]
            data["minute"] = part[4:6]

        # WIND PARSER (robust aviation parser)
        if part.endswith("KT"):

            wind_match = re.match(r"^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?KT$", part)

            if wind_match:
                data["wind_dir"] = wind_match.group(1)
                data["wind_speed_kt"] = wind_match.group(2)

                if wind_match.group(4):
                    data["wind_gust_kt"] = wind_match.group(4)
                else:
                    data["wind_gust_kt"] = None

        if part.isdigit() and len(part) == 4:
            data["visibility_m"] = int(part)

        if part in ["HZ","RA","+RA","-RA","TSRA","+TSRA","TS","+TS","-TS","SH","DS","SS","-TSRA"]:
            # Only set weather if not already set (get first weather occurrence)
            if data["weather"] is None:
                data["weather"] = part

        if part.startswith(("FEW","SCT","BKN","OVC")):
            data["cloud"] = part

        if "/" in part and len(part) == 5:
            t, d = part.split("/")
            data["temperature_c"] = t
            data["dewpoint_c"] = d

        if part.startswith("Q"):
            data["pressure_hpa"] = part[1:]

        if part == "NOSIG":
            data["trend"] = part

    # If there's TEMPO data, set trend to include it
    if data["tempo"]:
        data["trend"] = "TEMPO " + data["tempo"]

    # =========================
    # STATUS COLOR LOGIC
    # =========================
    status = "normal"  # default green
    
    # Check for danger conditions
    if detect_thunderstorm(metar):
        status = "danger"  # red - thunderstorm
    elif data["visibility_m"] and data["visibility_m"] < 3000:
        status = "danger"  # red - low visibility < 3000m
    elif data["weather"] and data["weather"] != "NIL":
        # Check for warning conditions
        warning_weather = ["RA", "FG", "HZ", "BR", "SH", "DS", "SS", "FC"]
        if any(code in data["weather"] for code in warning_weather):
            status = "warning"  # yellow/orange - moderate conditions
        elif "+" in data["weather"] or "TS" in data["weather"]:
            status = "danger"  # red - severe weather
    
    # Check visibility for warning (3-5km)
    if data["visibility_m"] and status != "danger":
        vis_val = data["visibility_m"]
        if 3000 <= vis_val <= 5000:
            status = "warning"  # yellow - moderate visibility
    
    data["status"] = status

    return data

# =========================
# HELPER: Format visibility value
# =========================
def format_visibility(vis_m):
    """Convert visibility in meters to display format"""
    if vis_m is None:
        return "NIL"
    
    # Specific visibility values
    if vis_m >= 10000 or vis_m == 9999:
        return "10 KM"
    elif vis_m == 8000:
        return "8 KM"
    elif vis_m == 7000:
        return "7 KM"
    elif vis_m == 6000:
        return "6 KM"
    elif vis_m == 5000:
        return "5 KM"
    elif vis_m == 4000:
        return "4 KM"
    elif vis_m == 3000:
        return "3 KM"
    elif vis_m == 2000:
        return "2 KM"
    elif vis_m == 1500:
        return "1.5 KM"
    elif vis_m == 1000:
        return "1 KM"
    elif vis_m >= 1000:
        return f"{vis_m // 1000} KM"
    else:
        return f"{vis_m} M"

# =========================
# HELPER: Convert parsed data to display format
# =========================
def format_parsed_for_display(parsed):
    """Convert parsed METAR data to display format for QAM and narrative"""
    display = {}
    
    # Station
    display["station"] = parsed.get("station") or "-"
    
    # Wind - format: 000°/00KT or 000°/00G00KT (with gust)
    if parsed.get("wind_dir") and parsed.get("wind_speed_kt"):
        if parsed.get("wind_gust_kt"):
            display["wind"] = f"{parsed['wind_dir']}°/{parsed['wind_speed_kt']}G{parsed['wind_gust_kt']} KT"
        else:
            display["wind"] = f"{parsed['wind_dir']}°/{parsed['wind_speed_kt']} KT"
    else:
        display["wind"] = "NIL"
    
    # Visibility - format: 10 KM or 5000 M
    display["visibility"] = format_visibility(parsed.get("visibility_m"))
    
    # Weather
    display["weather"] = parsed.get("weather") or "NIL"
    
    # Cloud - format: FEW010FT, BKN025FT CB, etc.
    if parsed.get("cloud"):
        cloud = parsed["cloud"]
        try:
            # cloud format in new parse: "BKN025" or "FEW015CB"
            amount = cloud[:3]
            height = int(cloud[3:6]) * 100
            cloud_str = f"{amount} {height}FT"
            if "CB" in cloud:
                cloud_str += " CB"
            elif "TCU" in cloud:
                cloud_str += " TCU"
            display["cloud"] = cloud_str
        except:
            display["cloud"] = cloud
    else:
        display["cloud"] = "NIL"
    
    # Temperature/Dewpoint - format: 28/24
    if parsed.get("temperature_c") and parsed.get("dewpoint_c"):
        display["temp_td"] = f"{parsed['temperature_c']}/{parsed['dewpoint_c']}"
    else:
        display["temp_td"] = "NIL"
    
    # Pressure QNH/QFE
    display["qnh"] = parsed.get("pressure_hpa") or "NIL"
    display["qfe"] = parsed.get("pressure_hpa") or "NIL"
    
    # Trend
    display["trend"] = parsed.get("trend") or "NIL"
    
    # Time info
    display["day"] = parsed.get("day") or "-"
    display["hour"] = parsed.get("hour") or "-"
    display["minute"] = parsed.get("minute") or "-"
    
    return display

# =========================
# GENERATE QAM FORMAT
# =========================
def generate_qam(station, parsed, raw_metar):
    # Convert parsed data to display format
    display = format_parsed_for_display(parsed)
    
    # Get time from raw METAR if not in parsed
    match = re.search(r'(\d{2})(\d{2})(\d{2})Z', raw_metar)
    if match:
        day, hour, minute = match.groups()
        now = datetime.utcnow()
        date_str = f"{day}/{now.strftime('%m/%Y')}"
        time_str = f"{hour}.{minute}"
    elif display["day"] != "-":
        date_str = f"{display['day']}/{datetime.utcnow().strftime('%m/%Y')}"
        time_str = f"{display['hour']}.{display['minute']}"
    else:
        date_str = "-"
        time_str = "-"

    qam = f"""MET REPORT (QAM)
BANDARA JUANDA ({station})
DATE    : {date_str}
TIME    : {time_str} UTC
========================
WIND    : {display['wind']}
VIS     : {display['visibility']}
WEATHER : {display['weather']}
CLOUD   : {display['cloud']}
TT/TD   : {display['temp_td']}
QNH     : {display['qnh']} MB
QFE     : {display['qfe']} MB
TREND   : {display['trend']}
"""
    return qam

# =========================
# GENERATE NARRATIVE TEXT
# =========================
def generate_metar_narrative(parsed, raw_metar=None):
    """Generate Indonesian narrative text from METAR data (without emojis)"""
    if not parsed:
        return "Data METAR tidak valid."
    
    # Use format_parsed_for_display to convert new structure to display format
    display = format_parsed_for_display(parsed)
    
    text = []
    
    # Get station info
    station = display.get('station', 'Unknown')
    if raw_metar and station == "-":
        station_match = re.match(r'([A-Z]{4})', raw_metar)
        if station_match:
            station = station_match.group(1)
    if station == "-":
        station = "Unknown"
    
    # Get observation time from METAR or parsed data
    day, hour, minute = "??", "??", "??"
    month_name = ""
    year = datetime.utcnow().year
    
    if raw_metar:
        time_match = re.search(r'(\d{2})(\d{2})(\d{2})Z', raw_metar)
        if time_match:
            day, hour, minute = time_match.groups()
            # Get month from current date
            month_name = datetime.utcnow().strftime("%B")
    elif display.get('day') != "-":
        day = display.get('day', '??')
        hour = display.get('hour', '??')
        minute = display.get('minute', '??')
        month_name = datetime.utcnow().strftime("%B")
    
    # Convert month name to Indonesian
    month_map = {
        "January": "Januari",
        "February": "Februari",
        "March": "Maret",
        "April": "April",
        "May": "Mei",
        "June": "Juni",
        "July": "Juli",
        "August": "Agustus",
        "September": "September",
        "October": "Oktober",
        "November": "November",
        "December": "Desember"
    }
    month_indonesian = month_map.get(month_name, month_name)
    
    text.append(f"Observasi cuaca di Bandara Juanda ({station}) pada tanggal {day} {month_indonesian} {year} pukul {hour}:{minute} UTC menunjukkan kondisi berikut:")
    
    # Wind information
    wind = display.get('wind', '')
    if wind and wind != 'NIL':
        text.append(f"Angin dari arah {wind}.")
    
    # Visibility information
    vis = display.get('visibility', '')
    if vis and vis != 'NIL':
        if vis == "10 KM":
            text.append("Jarak pandang sekitar 10 kilometer.")
        elif "KM" in vis:
            km_val = vis.replace("KM", "").strip()
            text.append(f"Jarak pandang sekitar {km_val} kilometer.")
        elif "M" in vis:
            m_val = vis.replace("M", "").strip()
            text.append(f"Jarak pandang sekitar {m_val} meter.")
        else:
            text.append(f"Visibilitas {vis}.")
    
    # Weather information
    weather = display.get('weather', '')
    if weather and weather != 'NIL':
        weather_map = {
            "HZ": "kabut asap",
            "RA": "hujan",
            "+RA": "hujan lebat",
            "-RA": "hujan ringan",
            "TS": "badai petir",
            "-TS": "badai petir ringan",
            "+TS": "badai petir kuat",
            "SH": "hujan shower",
            "DS": "debu pasir",
            "SS": "pasir badai",
            "-TSRA": "badai petir ringan disertai hujan",
            "TSRA": "badai petir disertai hujan",
            "+TSRA": "badai petir kuat disertai hujan"
        }
        desc = weather_map.get(weather, weather)
        text.append(f"Terdapat fenomena cuaca berupa {desc}.")
    
    # Cloud information with cloud_map
    cloud = display.get('cloud', '')
    if cloud and cloud != 'NIL':
        cloud_map = {
            "FEW": "awan sedikit",
            "SCT": "awan tersebar",
            "BKN": "awan banyak",
            "OVC": "awan menutup langit"
        }
        
        # Parse cloud format: "BKN 2500FT" or "FEW015CB"
        cloud_match = re.match(r'([A-Z]{3})\s*(\d+)', cloud)
        if cloud_match:
            cloud_type = cloud_match.group(1)
            cloud_height = cloud_match.group(2)
            desc = cloud_map.get(cloud_type, cloud_type)
            extra = ""
            if "CB" in cloud:
                extra = " CB (Cumulonimbus)"
            elif "TCU" in cloud:
                extra = " TCU (Towering Cumulus)"
            text.append(f"Terdapat {desc} pada ketinggian {cloud_height} kaki.{extra}")
        else:
            text.append(f"Awan: {cloud}.")
    
    # Temperature and dewpoint
    temp_td = display.get('temp_td', '')
    if temp_td and temp_td != 'NIL':
        temp_match = re.match(r'(\d{2})/(\d{2})', temp_td)
        if temp_match:
            temp = temp_match.group(1)
            dewpoint = temp_match.group(2)
            text.append(f"Suhu {temp}°C dengan titik embun {dewpoint}°C.")
    
    # Pressure
    qnh = display.get('qnh', '')
    if qnh and qnh != 'NIL':
        text.append(f"Tekanan udara {qnh} hPa.")
    
    # Trend
    trend = display.get('trend', '')
    if trend and trend != 'NIL':
        if trend == 'NOSIG':
            text.append("Tidak ada perubahan signifikan dalam waktu dekat.")
        elif trend.startswith('TEMPO'):
            tempo_content = trend[6:].strip()
            time_match = re.search(r'L(\d{4})', tempo_content)
            time_str = ""
            if time_match:
                time_val = time_match.group(1)
                time_str = f"pukul {time_val[:2]}:{time_val[2:]}"
            vis_match = re.search(r'(\d{4})', tempo_content)
            vis_str = ""
            if vis_match:
                vis_val = int(vis_match.group(1))
                # Use the detailed visibility logic matching format_visibility
                if vis_val >= 10000 or vis_val == 9999:
                    vis_str = "10 km"
                elif vis_val == 8000:
                    vis_str = "8 km"
                elif vis_val == 7000:
                    vis_str = "7 km"
                elif vis_val == 6000:
                    vis_str = "6 km"
                elif vis_val == 5000:
                    vis_str = "5 km"
                elif vis_val == 4000:
                    vis_str = "4 km"
                elif vis_val == 3000:
                    vis_str = "3 km"
                elif vis_val == 2000:
                    vis_str = "2 km"
                elif vis_val == 1500:
                    vis_str = "1.5 km"
                elif vis_val == 1000:
                    vis_str = "1 km"
                elif vis_val >= 1000:
                    vis_str = f"{vis_val // 1000} km"
                else:
                    vis_str = f"{vis_val} m"
            weather_map = {
                "HZ": "kabut asap", "RA": "hujan", "+RA": "hujan lebat",
                "-RA": "hujan ringan","-TSRA": "badai petir ringan disertai hujan",
                "TSRA": "badai petir disertai hujan", "+TSRA": "badai petir kuat disertai hujan", 
                "TS": "badai petir", "-TS": "badai petir ringan", "+TS": "badai petir kuat"
            }

            weather_found = None
            for code, desc in weather_map.items():
                if code in tempo_content:
                    weather_found = desc
                    break
            tempo_parts = []
            if time_str:
                tempo_parts.append(time_str)
            if vis_str:
                tempo_parts.append(f"visibilitas {vis_str}")
            if weather_found:
                tempo_parts.append(weather_found)
            if tempo_parts:
                text.append(f"Dalam waktu dekat, diperkirakan akan terjadi {', '.join(tempo_parts)}.")
            else:
                text.append(f"Tren: {trend}.")
        else:
            text.append(f"Tren: {trend}.")
    
    return " ".join(text)

# =========================
# HELPER FUNCTIONS FOR CHART DATA
# =========================
def extract_temp(metar):
    """Extract temperature from METAR string"""
    if not metar or not isinstance(metar, str):
        return 0
    try:
        parts = metar.split()
        for part in parts:
            if '/' in part and part != 'NIL':
                try:
                    temp = part.split('/')[0]
                    return int(temp) if temp.lstrip('-').isdigit() else 0
                except:
                    return 0
    except:
        return 0
    return 0

def extract_pressure(metar):
    """Extract pressure (QNH) from METAR string"""
    if not metar or not isinstance(metar, str):
        return 0
    try:
        if 'Q' in metar:
            try:
                idx = metar.find('Q')
                qnh = metar[idx+1:idx+5]
                return int(qnh) if qnh.isdigit() else 0
            except:
                return 0
    except:
        return 0
    return 0

@app.route("/api/latest")
def api_latest():

    if not os.path.exists(CSV_FILE):
        return jsonify({"labels": [], "temps": [], "pressures": []})

    df = pd.read_csv(CSV_FILE).tail(20)

    # Convert metar column to string and handle NaN values
    df["metar"] = df["metar"].fillna("").astype(str)

    labels = df["time"].tolist()
    temps = []
    pressures = []

    for metar in df["metar"]:

        # ===== TEMPERATURE =====
        if metar and isinstance(metar, str):
            temp_match = re.search(r'(\d{2})/(\d{2})', metar)
            if temp_match:
                temps.append(int(temp_match.group(1)))
            else:
                temps.append(None)
        else:
            temps.append(None)

        # ===== PRESSURE (QNH) =====
        if metar and isinstance(metar, str):
            qnh_match = re.search(r'Q(\d{4})', metar)
            if qnh_match:
                pressures.append(int(qnh_match.group(1)))
            else:
                pressures.append(None)
        else:
            pressures.append(None)

    return jsonify({
        "labels": labels,
        "temps": temps,
        "pressures": pressures
    })

# =========================
# API GET FULL HISTORY
# =========================
@app.route("/api/history")
def api_history():
    """API endpoint to get full history data including METAR strings"""
    if not os.path.exists(CSV_FILE):
        return jsonify({"data": []})

    df = pd.read_csv(CSV_FILE).tail(20)
    
    # Convert metar column to string and handle NaN values
    df["metar"] = df["metar"].fillna("").astype(str)

    # Reverse to show newest first
    df = df.iloc[::-1]

    history_data = []
    for _, row in df.iterrows():
        history_data.append({
            "time": str(row["time"]),
            "station": row["station"],
            "metar": row["metar"]
        })

    return jsonify({"data": history_data})

# =========================
# API GET METAR DATA
# =========================
@app.route("/api/metar/<station_code>")
def api_metar(station_code):
    """API endpoint to get current METAR data for a station"""
    metar = get_metar(station_code.upper())
    if not metar:
        return jsonify({"error": "No METAR available"})
    
    parsed = parse_metar(metar)
    display = format_parsed_for_display(parsed)
    
    # Extract wind direction and speed separately
    wind_direction = parsed.get("wind_dir") if parsed.get("wind_dir") else None
    wind_speed = parsed.get("wind_speed_kt") if parsed.get("wind_speed_kt") else None
    
    return jsonify({
        "wind": display["wind"],
        "wind_direction": wind_direction,
        "wind_speed": wind_speed,
        "visibility": display["visibility"],
        "weather": display["weather"],
        "cloud": display["cloud"],
        "qnh": display["qnh"]
    })

# =========================
# API GET NARRATIVE
# =========================
@app.route("/api/narrative/<station_code>")
def api_narrative(station_code):
    """API endpoint to get narrative text for a station"""
    metar = get_metar(station_code.upper())
    if not metar:
        return jsonify({"error": "No METAR available", "narrative": ""})
    
    parsed = parse_metar(metar)
    narrative = generate_metar_narrative(parsed, metar)
    
    return jsonify({
        "raw": metar,
        "narrative": narrative
    })

# =========================
# API WIND ROSE - Historical Wind Data
# =========================
@app.route("/api/windrose/<station>")
def windrose_api(station):
    """API endpoint to get historical wind data for Wind Rose chart"""
    data = list(wind_history)
    return jsonify(data)

# =========================
# HOME ROUTE
# =========================
@app.route("/", methods=["GET", "POST"])
def home():
    station = "WARR"
    metar = None
    parsed = None
    qam = None
    narrative = None
    temps = []
    pressures = []
    has_history = False

    print("\n=== HOME ROUTE CALLED ===")
    
    if request.method == "POST":
        station = request.form["icao"].upper()
        print(f"[HOME] POST request with station: {station}")

    print(f"[HOME] Fetching live METAR for {station}...")
    metar = get_metar(station)
    
    if metar:
        print(f"[HOME] Live METAR received: {metar[:50]}...")
        
        if not os.path.exists(CSV_FILE):
            df = pd.DataFrame(columns=["station", "time", "metar"])
            df.to_csv(CSV_FILE, index=False)

        df = pd.read_csv(CSV_FILE)

        if len(df) == 0 or df.iloc[-1]["metar"] != metar:
            new_row = {
                "station": station,
                "time": datetime.now(),
                "metar": metar
            }
            df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
            df.to_csv(CSV_FILE, index=False)
            print("[HOME] New METAR saved to CSV")

        parsed = parse_metar(metar)
        qam = generate_qam(station, parsed, metar)
        narrative = generate_metar_narrative(parsed, metar)
        
        # Store wind data for Wind Rose
        store_wind(parsed)
        
        print(f"[HOME] QAM generated successfully")
    else:
        print("[HOME] No live METAR available, checking CSV history...")
        # Try to get last known METAR from CSV if live fetch fails
        if os.path.exists(CSV_FILE):
            df = pd.read_csv(CSV_FILE)
            if len(df) > 0:
                # Get the most recent METAR
                last_row = df.iloc[-1]
                metar = last_row['metar']
                station = last_row['station']
                parsed = parse_metar(metar)
                qam = generate_qam(station, parsed, metar)
                narrative = generate_metar_narrative(parsed, metar)
                
                 # 🔥 KIRIM WA DI SINI
            if qam:
                send_whatsapp_message(qam)

                print(f"[HOME] Using historical METAR: {metar[:50]}...")

    # Read history and prepare chart data
    if os.path.exists(CSV_FILE):
        history = pd.read_csv(CSV_FILE).tail(20)
        
        # Convert metar column to string and handle NaN values
        history["metar"] = history["metar"].fillna("").astype(str)
        
        has_history = not history.empty
        if has_history:
            labels = history['time'].tolist()
            temps = [extract_temp(m) for m in history['metar'].tolist()]
            pressures = [extract_pressure(m) for m in history['metar'].tolist()]
            # Reverse data so newest is at the top in table (charts show oldest->newest left to right)
            labels = labels[::-1]
            temps = temps[::-1]
            pressures = pressures[::-1]
        else:
            labels = []
    else:
        history = pd.DataFrame(columns=["station", "time", "metar"])
        labels = []
    
    # Create latest dict for the METAR display with status color
    latest = None
    if metar and parsed:
        latest = {
            "station": station,
            "metar": metar,
            "status": parsed.get("status", "normal")
        }
    
    last_saved = history["time"].iloc[-1] if has_history else "N/A"
    print(f"[HOME] Rendering template with QAM: {qam is not None}")

    return render_template(
        "index.html",
        station=station,
        latest=latest,
        qam=qam,
        narrative=narrative,
        history=history,
        last_saved=last_saved,
        temps=temps,
        pressures=pressures,
        labels=labels,
        has_history=has_history
    )

# =========================
# DOWNLOAD QAM
# =========================
@app.route("/download_qam")
def download_qam():
    station = request.args.get("station")
    qam = request.args.get("qam")
    if not qam:
        return "Tidak ada QAM untuk di-download", 400

    buffer = BytesIO()
    buffer.write(qam.encode())
    buffer.seek(0)

    return send_file(
        buffer,
        as_attachment=True,
        download_name=f"QAM_{station}.txt",
        mimetype="text/plain"
    )

# =========================
# DOWNLOAD CSV HISTORY
# =========================
@app.route("/download_csv")
def download_csv():
    if not os.path.exists(CSV_FILE):
        return "CSV belum tersedia", 400

    buffer = BytesIO()
    df = pd.read_csv(CSV_FILE)
    df.to_csv(buffer, index=False)
    buffer.seek(0)

    return send_file(
        buffer,
        as_attachment=True,
        download_name="metar_history.csv",
        mimetype="text/csv"
    )

# =========================
# HISTORY BY DATE RANGE
# =========================
@app.route("/history_by_date", methods=["GET", "POST"])
def history_by_date():

    results = None
    station = "WARR"  # Default station

    if request.method == "POST":
        station = request.form.get("icao", "WARR").upper()
        start_date = request.form.get("start_date", "")
        end_date = request.form.get("end_date", "")
        
        print(f"[HISTORY] Station: {station}, Start: {start_date}, End: {end_date}")

        if start_date and end_date:
            # Read CSV
            if os.path.exists(CSV_FILE):
                df = pd.read_csv(CSV_FILE)
                print(f"[HISTORY] Total rows in CSV: {len(df)}")
                
                # Convert time column to datetime
                df["time"] = pd.to_datetime(df["time"], errors='coerce')
                
                # Convert input dates (datetime-local gives format like "2026-02-23T13:29")
                start = pd.to_datetime(start_date)
                # Add one day to end date to include the full day
                end = pd.to_datetime(end_date) + pd.Timedelta(days=1)
                
                print(f"[HISTORY] Filter: station={station}, start={start}, end={end}")
                
                # Filter by station and date range
                results = df[
                    (df["station"] == station) &
                    (df["time"] >= start) &
                    (df["time"] <= end)
                ]
                
                print(f"[HISTORY] Filtered rows: {len(results) if results is not None else 0}")
            else:
                print("[HISTORY] CSV file does not exist")

    return render_template(
        "history_by_date.html",
        results=results,
        station=station
    )


def background_metar_loop():
    print("✅ Background loop started")

    while True:
        try:
            station = "WARR"
            print(f"\n=== Background loop iteration ===")
            print(f"[LOOP] Fetching METAR for station: {station}")
            
            metar = get_metar(station)
            
            if metar:
                print(f"[LOOP] METAR received: {metar[:50]}...")

                # Simpan ke CSV kalau beda
                if not os.path.exists(CSV_FILE):
                    print("[LOOP] CSV file doesn't exist, creating new one...")
                    df = pd.DataFrame(columns=["station","time","metar"])
                    df.to_csv(CSV_FILE, index=False)

                df = pd.read_csv(CSV_FILE)
                
                print(f"[LOOP] Current CSV rows: {len(df)}")

                if len(df) == 0 or df.iloc[-1]["metar"] != metar:
                    print("[LOOP] NEW METAR detected! Saving to CSV...")
                    new_row = {
                        "station": station,
                        "time": datetime.now(),
                        "metar": metar
                    }

                    df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
                    df.to_csv(CSV_FILE, index=False)

                    print("🔥 NEW METAR SAVED & EMITTED via WebSocket!")

                    parsed = parse_metar(metar)
                    qam = generate_qam(station, parsed, metar)
                    narrative = generate_metar_narrative(parsed, metar)
                    
                    print(f"[LOOP] QAM generated:\n{qam}")
                    print(f"[LOOP] Narrative generated:\n{narrative}")

                    socketio.emit("metar_update", {
                        "status": "new",
                        "qam": qam,
                        "raw": metar,
                        "narrative": narrative,
                        "time": datetime.now().strftime("%d-%m-%Y %H:%M:%S")
                    })
                else:
                    print("[LOOP] METAR unchanged, skipping save")
            else:
                print("[LOOP] ❌ No METAR received from NOAA!")

        except Exception as e:
            print(f"[LOOP] ERROR: {e}")
            import traceback
            traceback.print_exc()

        print(f"[LOOP] Sleeping for 60 seconds...")
        socketio.sleep(60)  # WAJIB ini, bukan time.sleep

#connect websocket
@socketio.on("connect")
def handle_connect():
    print("Client connected")

@app.route("/download_history", methods=["POST"])
def download_history():

    station = request.form["icao"].upper()
    start_date = request.form["start_date"]
    end_date = request.form["end_date"]

    df = pd.read_csv(CSV_FILE)
    df["time"] = pd.to_datetime(df["time"])

    start = pd.to_datetime(start_date)
    end = pd.to_datetime(end_date)

    results = df[
        (df["station"] == station) &
        (df["time"] >= start) &
        (df["time"] <= end)
    ]

    output = io.StringIO()
    results.to_csv(output, index=False)

    return send_file(
        io.BytesIO(output.getvalue().encode()),
        mimetype="text/csv",
        as_attachment=True,
        download_name=f"{station}_history.csv"
    )

# =========================
# MANUAL METAR PARSER
# =========================
@app.route("/manual_parser", methods=["GET", "POST"])
def manual_parser():

    raw_metar = None
    parsed_qam = None

    if request.method == "POST":
        raw_metar = request.form["raw_metar"].strip()
        station = raw_metar.split()[1]
        parsed = parse_metar(raw_metar)
        parsed_qam = generate_qam(station, parsed, raw_metar)

    return render_template(
        "manual_parser.html",
        raw_metar=raw_metar,
        parsed_qam=parsed_qam
    )

@socketio.on("connect")
def handle_connect():
    print("Client connected")

background_thread = None

if __name__ == "__main__":
    if background_thread is None:
        background_thread = socketio.start_background_task(background_metar_loop)

    socketio.run(app, debug=True, use_reloader=False)
