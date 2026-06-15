# ✈ Flight Tracker PWA

Live flight tracking sa push notifikacijama. Instalabilna kao app na Android.

## Stack
- **Backend**: Python Flask + Gunicorn
- **Live pozicija**: OpenSky Network (besplatno, ADS-B)
- **Flight info**: AviationStack (besplatno, 100 req/mesec)
- **Notifikacije**: Web Push (pywebpush + VAPID)
- **Mapa**: Leaflet.js + CartoDB Dark tiles
- **Hosting**: Render.com (free tier)

## Notifikacije koje šalje
- ✈️ Let poleteo
- 🛬 Sletanje za 60 / 30 / 15 minuta
- 🛬 Let sleteo
- ⏰ Kašnjenje detektovano
- ❌ Let otkazan / preusmeren

---

## Deploy (Render.com — besplatno)

### Korak 1 — API ključ
1. Registruj se na https://aviationstack.com (Free plan, 100 req/mesec)
2. Kopiraj API key

### Korak 2 — GitHub
```bash
git init
git add .
git commit -m "init"
# Napravi repo na github.com pa:
git remote add origin https://github.com/TVO_USERNAME/flight-tracker.git
git push -u origin main
```

### Korak 3 — VAPID ključevi (lokalno)
```bash
pip install py-vapid cryptography
python generate_keys.py
# Kopiraj outputovane ključeve
```

### Korak 4 — Render
1. Idi na https://render.com → New → Web Service
2. Poveži GitHub repo
3. Build command: `pip install -r requirements.txt`
4. Start command: `gunicorn app:app --workers 1 --timeout 120`
5. Environment variables dodaj:
   - `AVIATIONSTACK_KEY` = tvoj ključ
   - `VAPID_PUBLIC_KEY` = iz generate_keys.py
   - `VAPID_PRIVATE_KEY` = iz generate_keys.py
   - `VAPID_EMAIL` = mailto:tvoj@email.com

### Korak 5 — Instalacija na telefon
1. Otvori URL od Render u Chrome na Androidu
2. Menu → "Add to Home Screen"
3. Instalira se kao app

---

## Lokalno pokretanje (test)

```bash
pip install -r requirements.txt
export AVIATIONSTACK_KEY=tvoj_kljuc
python app.py
# http://localhost:5000
```

---

## Napomena o Render free tier
Render gasi servis posle 15min neaktivnosti.  
Kad ga neko otvori, treba ~30s da se probudi.  
Za lične potrebe (povremena upotreba) ovo je OK.
