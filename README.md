# SteamG

A Python Flask web app that takes a Steam ID and generates an interactive graph of a user's game library.

## Features

- Enter any Steam ID to fetch game library data via the Steam Web API
- Visualize your games as an interactive, explorable graph
- See playtime, game connections, and library stats at a glance

## Setup

```bash
git clone https://github.com/yourusername/steamg.git
cd steamg
pip install -r requirements.txt
```

Set your Steam API key as an environment variable:

```bash
export STEAM_API_KEY=your_api_key_here
```

## Running

```bash
flask run
```

Then open `http://localhost:5000` in your browser, enter a Steam ID, and explore your game graph.

## Usage

1. Find your Steam ID (visible in your profile URL or via [steamid.io](https://steamid.io))
2. Paste it into the input field and hit **Generate**
3. Interact with the graph — zoom, pan, and click nodes to see game details

## License

MIT
