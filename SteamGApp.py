from flask import Flask, request, redirect, session, render_template, jsonify
import requests
import json
import re
import os
from dotenv import load_dotenv
from steam_web_api import Steam

load_dotenv()
app = Flask(__name__, template_folder="UI")
steam = Steam(os.getenv('API_KEY'))


@app.route('/')
def index():
    return render_template('index.html')


def resolve_steam_id(raw):
    """
    Accepts a 17-digit Steam ID, a steamcommunity.com profile URL,
    or a vanity username. Returns the resolved 64-bit Steam ID string,
    or raises ValueError if it cannot be resolved.
    """
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


if __name__ == "__main__":
    app.run(debug=True)
