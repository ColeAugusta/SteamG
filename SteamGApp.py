from flask import Flask, request, redirect, session, render_template, jsonify
import requests
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
from steam_web_api import Steam

load_dotenv()
app = Flask(__name__, template_folder="UI", static_folder="UI")
steam = Steam(os.getenv('API_KEY'))

@app.route('/')
def index():
    return render_template('index.html')


def resolve_steam_id(raw):
    raw = raw.strip().rstrip('/')
    for prefix in [
        'https://steamcommunity.com/profiles/',
        'http://steamcommunity.com/profiles/',
        'steamcommunity.com/profiles/',
    ]:
        if raw.startswith(prefix):
            raw = raw[len(prefix):]
            break
    for prefix in [
        'https://steamcommunity.com/id/',
        'http://steamcommunity.com/id/',
        'steamcommunity.com/id/',
    ]:
        if raw.startswith(prefix):
            raw = raw[len(prefix):]
            break

    # already a 64-bit Steam ID
    if raw.isdigit() and len(raw) == 17:
        return raw
    # treat as vanity username
    api_key = os.getenv('API_KEY')
    resp = requests.get(
        'https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/',
        params={'key': api_key, 'vanityurl': raw},
        timeout=10
    )
    resp.raise_for_status()
    result = resp.json().get('response', {})

    if result.get('success') != 1:
        raise ValueError(f"Could not find Steam user '{raw}'")

    return result['steamid']


@app.route('/resolve-user', methods=['POST'])
def resolve_user():
    data = request.json
    raw = (data or {}).get('username', '').strip()

    if not raw:
        return jsonify({'error': 'username required'}), 400

    try:
        steam_id = resolve_steam_id(raw)
        return jsonify({'steam_id': steam_id})
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/get-games', methods=['POST'])
def get_games():
    data = request.json
    raw = (data or {}).get('steam_id', '').strip()

    if not raw:
        return jsonify({'error': 'steam_id required'}), 400

    try:
        steam_id = resolve_steam_id(raw)
        user = steam.users.get_owned_games(steam_id, include_appinfo=True)
        games = user.get('games', [])
        return jsonify({'games': games})
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _fetch_steamspy(appid):
    resp = requests.get(
        'https://steamspy.com/api.php',
        params={'request': 'appdetails', 'appid': appid},
        timeout=10
    )
    resp.raise_for_status()
    return resp.json()


def _fetch_genres_for_app(appid):
    try:
        data = _fetch_steamspy(appid)
        genre_str = data.get('genre', '') or ''
        genres = [g.strip() for g in genre_str.split(',') if g.strip()]
        return appid, genres
    except Exception:
        return appid, []


@app.route('/get-genres', methods=['POST'])
def get_genres():
    data = request.json
    appids = (data or {}).get('appids', [])

    if not appids or not isinstance(appids, list):
        return jsonify({'error': 'appids list required'}), 400

    # top 50 games
    appids = appids[:50]

    result = {}
    # using concurrent api calls to get genres for all games
    # at once, so that it doesn't take forever
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(_fetch_genres_for_app, aid): aid for aid in appids}
        for future in as_completed(futures):
            appid, genres = future.result()
            result[str(appid)] = genres

    return jsonify({'genres': result})


def _fetch_tags_for_app(appid):
    try:
        data = _fetch_steamspy(appid)
        tags = data.get('tags') or {}
        if isinstance(tags, dict):
            sorted_tags = sorted(tags.items(), key=lambda x: x[1], reverse=True)
            return appid, [t[0] for t in sorted_tags[:8]]
        return appid, []
    except Exception:
        return appid, []


@app.route('/get-tags', methods=['POST'])
def get_tags():
    data = request.json
    appids = (data or {}).get('appids', [])

    if not appids or not isinstance(appids, list):
        return jsonify({'error': 'appids list required'}), 400

    appids = appids[:50]

    result = {}
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(_fetch_tags_for_app, aid): aid for aid in appids}
        for future in as_completed(futures):
            appid, tags = future.result()
            result[str(appid)] = tags

    return jsonify({'tags': result})


if __name__ == "__main__":
    app.run(debug=True)
