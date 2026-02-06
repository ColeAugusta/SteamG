from flask import Flask, request, redirect, session, render_template, jsonify
import requests
import json
import re
import os
from dotenv import load_dotenv
from steam_web_api import Steam

load_dotenv()
app = Flask(__name__)
steam = Steam(os.getenv('API_KEY'))


@app.route('/')
def index():
    return render_template('./UI/index.html')

@app.route('/resolve-user')
def resolve_user():
    data = request.json
    username = data.get('username', '').strip()

    if not username:
        return jsonify({'error': 'user required'}), 400
    
    # remove extra URL prefixes if user copy pasted
    username = username.replace('https://steamcommunity.com/id/', '')
    username = username.replace('http://steamcommunity.com/id/', '')
    username = username.replace('steamcommunity.com/id/', '')
    username = username.replace('https://steamcommunity.com/profiles/', '')
    username = username.replace('http://steamcommunity.com/profiles/', '')
    username = username.replace('steamcommunity.com/profiles/', '')
    username = username.rstrip('/')

    try:
        # check if steam id
        if username.isdigit() and len(username) == 17:
            pass
    except Exception as e:
        return jsonify({'error': 'idk some error'})



@app.route('/get-games', methods=['POST'])
def get_games():
    data = request.json
    steam_id = data.get('steam_id')

    if not steam_id:
        return jsonify({'error': 'Steam ID required'}), 400
    
    try:
        user = steam.users.get_owned_games(steam_id)
        games = user['games']
        print(games)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    

