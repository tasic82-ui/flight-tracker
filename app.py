from flask import Flask, jsonify, request, render_template, send_from_directory
from flask_cors import CORS
import requests
import json
import time
import threading
import math
from datetime import datetime, timezone
from pywebpush import webpush, WebPushException
import os

app = Flask(__name__)
CORS(app)

# ─── CONFIG ───────────────────────────────────────────────────────────────────
AVIATIONSTACK_KEY = os.environ.get("AVIATIONSTACK_KEY", "YOUR_KEY_HERE")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY  = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_EMAIL       = os.environ.get("VAPID_EMAIL", "mailto:your@email.com")

# In-memory stores (for free tier — no DB needed)
subscriptions = {}   # token -> subscription_info
tracked_flights = {} # flight_number -> { subscribers, last_status, last_notif }

# ─── OPENSKY ──────────────────────────────────────────────────────────────────
def get_opensky_position(callsign):
    """Get live ADS-B position from OpenSky Network (free, no key needed)"""
    try:
        callsign_padded = callsign.upper().ljust(8)
        url = f"https://opensky-network.org/api/states/all?time=0"
        r = requests.get(url, timeout=10)
        if r.status_code != 200:
            return None
        data = r.json()
        if not data.get("states"):
            return None
        for state in data["states"]:
            if state[1] and state[1].strip() == callsign.upper():
                return {
                    "icao24":    state[0],
                    "callsign":  state[1].strip(),
                    "latitude":  state[6],
                    "longitude": state[5],
                    "altitude":  round(state[7] * 3.28084) if state[7] else None,  # ft
                    "velocity":  round(state[9] * 1.944) if state[9] else None,     # knots
                    "heading":   state[10],
                    "on_ground": state[8],
                    "timestamp": state[4]
                }
        return None
    except Exception as e:
        print(f"OpenSky error: {e}")
        return None

# ─── AVIATIONSTACK ────────────────────────────────────────────────────────────
def get_flight_info(flight_number):
    """Get scheduled + status info from AviationStack"""
    try:
        iata = ''.join(filter(str.isalpha, flight_number))
        number = ''.join(filter(str.isdigit, flight_number))
        url = "http://api.aviationstack.com/v1/flights"
        params = {
            "access_key": AVIATIONSTACK_KEY,
            "flight_iata": flight_number.upper(),
            "limit": 1
        }
        r = requests.get(url, params=params, timeout=10)
        if r.status_code != 200:
            return None
        data = r.json()
        if not data.get("data"):
            return None
        f = data["data"][0]
        dep = f.get("departure", {})
        arr = f.get("arrival", {})

        def parse_time(t):
            if not t:
                return None
            try:
                return datetime.fromisoformat(t.replace("Z", "+00:00"))
            except:
                return None

        sched_arr   = parse_time(arr.get("scheduled"))
        est_arr     = parse_time(arr.get("estimated")) or sched_arr
        actual_arr  = parse_time(arr.get("actual"))
        sched_dep   = parse_time(dep.get("scheduled"))
        actual_dep  = parse_time(dep.get("actual"))

        now = datetime.now(timezone.utc)
        minutes_to_arrival = None
        if est_arr and not actual_arr:
            diff = (est_arr - now).total_seconds() / 60
            minutes_to_arrival = int(diff)

        delay_min = arr.get("delay") or 0

        return {
            "flight_number": flight_number.upper(),
            "airline":       f.get("airline", {}).get("name", ""),
            "status":        f.get("flight_status", "unknown"),
            "departure": {
                "airport":   dep.get("airport", ""),
                "iata":      dep.get("iata", ""),
                "scheduled": dep.get("scheduled"),
                "actual":    dep.get("actual"),
                "terminal":  dep.get("terminal"),
                "gate":      dep.get("gate"),
            },
            "arrival": {
                "airport":   arr.get("airport", ""),
                "iata":      arr.get("iata", ""),
                "scheduled": arr.get("scheduled"),
                "estimated": arr.get("estimated"),
                "actual":    arr.get("actual"),
                "terminal":  arr.get("terminal"),
                "gate":      arr.get("gate"),
                "delay_min": delay_min,
            },
            "minutes_to_arrival": minutes_to_arrival,
            "is_delayed": delay_min > 15,
        }
    except Exception as e:
        print(f"AviationStack error: {e}")
        return None

# ─── COMBINED FLIGHT DATA ─────────────────────────────────────────────────────
def get_combined_flight(flight_number):
    info     = get_flight_info(flight_number)
    position = get_opensky_position(flight_number)
    return {
        "info":     info,
        "position": position,
        "updated":  datetime.now(timezone.utc).isoformat()
    }

# ─── PUSH NOTIFICATIONS ───────────────────────────────────────────────────────
def send_push(subscription_info, title, body, data=None):
    try:
        payload = json.dumps({"title": title, "body": body, "data": data or {}})
        webpush(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_EMAIL}
        )
        return True
    except WebPushException as e:
        print(f"Push failed: {e}")
        return False

def notify_subscribers(flight_number, title, body, data=None):
    if flight_number not in tracked_flights:
        return
    dead = []
    for token, sub in tracked_flights[flight_number]["subscribers"].items():
        ok = send_push(sub, title, body, data)
        if not ok:
            dead.append(token)
    for t in dead:
        tracked_flights[flight_number]["subscribers"].pop(t, None)

# ─── BACKGROUND POLLER ────────────────────────────────────────────────────────
def poll_flights():
    """Poll every 60s, send push notifications on status changes"""
    while True:
        for flight_num, state in list(tracked_flights.items()):
            if not state["subscribers"]:
                continue
            try:
                data = get_combined_flight(flight_num)
                info = data.get("info")
                if not info:
                    continue

                status   = info.get("status")
                last     = state.get("last_status")
                mta      = info.get("minutes_to_arrival")
                notified = state.get("notified_milestones", set())

                # Status change notification
                if status != last:
                    state["last_status"] = status
                    msgs = {
                        "active":    ("✈️ Let je poleteo!", f"{flight_num} je u vazduhu."),
                        "landed":    ("🛬 Let je sleteo!", f"{flight_num} je sleteo."),
                        "cancelled": ("❌ Let otkazan", f"{flight_num} je otkazan."),
                        "diverted":  ("⚠️ Let preusmeren", f"{flight_num} je preusmeren."),
                    }
                    if status in msgs:
                        title, body = msgs[status]
                        notify_subscribers(flight_num, title, body, {"flight": flight_num, "status": status})

                # Delay notification
                if info.get("is_delayed") and "delay" not in notified:
                    delay = info["arrival"]["delay_min"]
                    notify_subscribers(flight_num, "⏰ Kašnjenje", f"{flight_num} kasni {delay} minuta.", {"flight": flight_num})
                    notified.add("delay")

                # ETA milestone notifications
                if mta is not None:
                    for milestone in [60, 30, 15]:
                        key = f"eta_{milestone}"
                        if mta <= milestone and key not in notified:
                            notify_subscribers(flight_num, f"🛬 Sletanje za {milestone} min", f"{flight_num} sleće za oko {milestone} minuta.", {"flight": flight_num})
                            notified.add(key)

                state["notified_milestones"] = notified

            except Exception as e:
                print(f"Poll error for {flight_num}: {e}")

        time.sleep(60)

# ─── API ROUTES ───────────────────────────────────────────────────────────────
@app.route("/api/flight/<flight_number>")
def api_flight(flight_number):
    data = get_combined_flight(flight_number.upper())
    return jsonify(data)

@app.route("/api/track", methods=["POST"])
def api_track():
    body          = request.json
    flight_number = body.get("flight_number", "").upper()
    subscription  = body.get("subscription")
    token         = body.get("token")

    if not flight_number or not subscription or not token:
        return jsonify({"error": "Missing fields"}), 400

    if flight_number not in tracked_flights:
        tracked_flights[flight_number] = {
            "subscribers": {},
            "last_status": None,
            "notified_milestones": set()
        }

    tracked_flights[flight_number]["subscribers"][token] = subscription
    return jsonify({"ok": True, "tracking": flight_number})

@app.route("/api/untrack", methods=["POST"])
def api_untrack():
    body          = request.json
    flight_number = body.get("flight_number", "").upper()
    token         = body.get("token")
    if flight_number in tracked_flights:
        tracked_flights[flight_number]["subscribers"].pop(token, None)
    return jsonify({"ok": True})

@app.route("/api/vapid-public-key")
def vapid_key():
    return jsonify({"key": VAPID_PUBLIC_KEY})

@app.route("/api/tracked")
def api_tracked():
    token = request.args.get("token", "")
    result = []
    for flight_num, state in tracked_flights.items():
        if token in state["subscribers"]:
            result.append(flight_num)
    return jsonify({"flights": result})

# ─── PWA ROUTES ───────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/sw.js")
def sw():
    return send_from_directory("static/js", "sw.js", mimetype="application/javascript")

@app.route("/manifest.json")
def manifest():
    return send_from_directory("static", "manifest.json")

# ─── STARTUP ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if VAPID_PRIVATE_KEY:
        t = threading.Thread(target=poll_flights, daemon=True)
        t.start()
        print("✅ Background poller started")
    else:
        print("⚠️  VAPID keys not set — push notifications disabled")
    app.run(debug=False, host="0.0.0.0", port=5000)
