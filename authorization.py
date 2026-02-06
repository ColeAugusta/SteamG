from flask import Flask, request, redirect, session, render_template
import requests
import re
import os
from dotenv import load_dotenv
from steam_web_api import Steam

load_dotenv()
app = Flask(__name__)
steam = Steam(os.getenv('API_KEY'))

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/get-games', methods=['POST'])
def get_games():
    response = steam.users.get_owned_games("76561198147960753")
    for game in response['games']:
        print(game['name'])

