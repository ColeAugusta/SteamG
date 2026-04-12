    // build graph from games with D3 graph framework
    let simulation = null;
    let currentGames = null;
    let currentGenreMap = {};
    let currentTagMap = null;
    
    // returns {nw, nh} for the 2:3 portrait card (library_600x900 aspect ratio).
    // sqrt scaling so high-hour games are visibly larger
    function nodeSize(playtimeMinutes) {
        const hrs = playtimeMinutes / 60;
        const h = Math.max(90, Math.min(270, 40 + Math.sqrt(hrs) * 12));
        return { nw: Math.round(h * 2 / 3), nh: Math.round(h) };
    }


    function setStatus(msg, isError = false) {
        const el = document.getElementById('status');
        el.textContent = msg;
        el.className = isError ? 'error' : '';
    }


    async function loadGames() {
        const input = document.getElementById('steam-id-input').value.trim();
        if (!input) { setStatus('Please enter a Steam ID.', true); return; }

        setStatus('Loading games…');
        if (simulation) simulation.stop();
        d3.select('#graph-container svg').remove();
        document.getElementById('legend').style.display = 'none';
        currentGames = null;
        currentGenreMap = {};
        currentTagMap = null;
        const groupByEl = document.getElementById('group-by');
        groupByEl.value = 'genre';
        groupByEl.disabled = true;

        let games;
        try {
            const res = await fetch('/get-games', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ steam_id: input })
            });
            const data = await res.json();
            if (!res.ok || data.error) { setStatus(data.error || 'Failed to load games.', true); return; }
            games = data.games || [];
        } catch (err) {
            setStatus('Network error: ' + err.message, true);
            return;
        }

        if (games.length === 0) { setStatus('No games found (profile may be private).', true); return; }

        // top-N for genre fetch are the most-played
        games.sort((a, b) => b.playtime_forever - a.playtime_forever);

        const fetchCount = Math.min(games.length, 200);
        setStatus(`${games.length} games found — fetching genre data for top ${fetchCount}…`);

        // render nodes immediately (no edges yet)
        renderGraph(games, {}, 'Genre');

        const top50 = games.slice(0, fetchCount).map(g => g.appid);
        let genreMap = {};
        try {
            const res = await fetch('/get-genres', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ appids: top50 })
            });
            const data = await res.json();
            genreMap = data.genres || {};
        } catch (_) { /* genre fetch failed, graph still works without edges */ }

        // re-render with edges
        if (simulation) simulation.stop();
        d3.select('#graph-container svg').remove();
        currentGames = games;
        currentGenreMap = genreMap;
        renderGraph(games, genreMap, 'Genre');
        document.getElementById('group-by').disabled = false;
    }


    function renderGraph(games, dataMap, dataLabel = 'Genre') {
        const container = document.getElementById('graph-container');
        const W = container.clientWidth;
        const H = container.clientHeight;

        // build color scale
        const labelCount = {};
        Object.values(dataMap).forEach(labels => {
            labels.forEach(l => { labelCount[l] = (labelCount[l] || 0) + 1; });
        });
        const totalFetched = Object.keys(dataMap).length || 1;

        // marks labels that appear in >40% of fetched games as ubiquitous (skip for edges)
        const ubiquitous = new Set(
            Object.entries(labelCount)
                .filter(([, c]) => c / totalFetched > 0.4)
                .map(([g]) => g)
        );

        const topGenres = Object.entries(labelCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([g]) => g);

        const colorScale = d3.scaleOrdinal(d3.schemeTableau10).domain(topGenres);
        const FALLBACK_COLOR = '#4a6a8a';

        function nodeColor(appid) {
            const labels = dataMap[String(appid)] || [];
            for (const g of labels) {
                if (topGenres.includes(g)) return colorScale(g);
            }
            return FALLBACK_COLOR;
        }

        const nodes = games.map(g => {
            const { nw, nh } = nodeSize(g.playtime_forever);
            return {
                id: g.appid,
                name: g.name,
                playtime: g.playtime_forever,
                labels: dataMap[String(g.appid)] || [],
                nw, nh,
                color: nodeColor(g.appid)
            };
        });

        const nodeById = new Map(nodes.map(n => [n.id, n]));

        // genre/tag edges: games sharing a non-ubiquitous label
        const edges = [];
        const appidsWithData = Object.keys(dataMap).map(Number);

        for (let i = 0; i < appidsWithData.length; i++) {
            for (let j = i + 1; j < appidsWithData.length; j++) {
                const a = appidsWithData[i];
                const b = appidsWithData[j];
                const ga = new Set((dataMap[a] || []).filter(g => !ubiquitous.has(g)));
                const gb = (dataMap[b] || []).filter(g => !ubiquitous.has(g));
                const shared = gb.filter(g => ga.has(g));
                if (shared.length > 0 && nodeById.has(a) && nodeById.has(b)) {
                    edges.push({ source: a, target: b, weight: shared.length });
                }
            }
        }

        // connect all no-label nodes via a star so they cluster together
        const noDataNodes = nodes.filter(n => n.labels.length === 0);
        if (noDataNodes.length > 1) {
            const hub = noDataNodes[0];
            for (let i = 1; i < noDataNodes.length; i++) {
                edges.push({ source: hub.id, target: noDataNodes[i].id, weight: 1 });
            }
        }

        const edgeCount = edges.length;
        const gameCount = nodes.length;

        setStatus(`${gameCount} games · ${edgeCount} genre connections`);

        const svg = d3.select('#graph-container').append('svg');
        const g = svg.append('g');

        svg.call(
            d3.zoom()
                .scaleExtent([0.05, 8])
                .on('zoom', e => g.attr('transform', e.transform))
        );

        // clip-paths for rounded-rect image masking 
        const defs = svg.append('defs');
        nodes.forEach(d => {
            defs.append('clipPath')
                .attr('id', `clip-${d.id}`)
                .append('rect')
                .attr('x', -d.nw / 2).attr('y', -d.nh / 2)
                .attr('width', d.nw).attr('height', d.nh)
                .attr('rx', 6).attr('ry', 6);
        });

        // draw edges/nodes
        const link = g.append('g')
            .selectAll('line')
            .data(edges)
            .join('line')
            .attr('stroke', '#4a6a8a')
            .attr('stroke-opacity', 0.35)
            .attr('stroke-width', d => Math.min(d.weight, 3));

        const tooltip = document.getElementById('tooltip');

        const node = g.append('g')
            .selectAll('g.node')
            .data(nodes)
            .join('g')
            .attr('class', 'node')
            .style('cursor', 'pointer')
            .on('mouseover', function(event, d) {
                node.attr('opacity', n => n === d ? 1 : 0.15);
                link.attr('stroke-opacity', l =>
                    (l.source === d || l.target === d) ? 0.8 : 0.05
                );

                const hrs = (d.playtime / 60).toFixed(1);
                document.getElementById('t-name').textContent = d.name;
                document.getElementById('t-hours').textContent =
                    hrs === '0.0' ? 'Never played' : `${hrs} hrs played`;
                document.getElementById('t-genres').textContent =
                    d.labels.length ? d.labels.join(', ') : `No ${dataLabel.toLowerCase()} data`;
                tooltip.style.opacity = '1';
            })
            .on('mousemove', event => {
                const rect = container.getBoundingClientRect();
                let x = event.clientX - rect.left + 14;
                let y = event.clientY - rect.top + 14;
                if (x + 230 > W) x -= 240;
                if (y + 90 > H) y -= 100;
                tooltip.style.left = x + 'px';
                tooltip.style.top = y + 'px';
            })
            .on('mouseout', function() {
                node.attr('opacity', 1);
                link.attr('stroke-opacity', 0.35);
                tooltip.style.opacity = '0';
            })
            .on('click', (event, d) => {
                window.open(`https://store.steampowered.com/app/${d.id}/`, '_blank');
            })
            .call(
                d3.drag()
                    .on('start', (event, d) => {
                        if (!event.active) simulation.alphaTarget(0.3).restart();
                        d.fx = d.x; d.fy = d.y;
                    })
                    .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
                    .on('end', (event, d) => {
                        if (!event.active) simulation.alphaTarget(0);
                        d.fx = null; d.fy = null;
                    })
            );

        // genre color fallback + border
        node.append('rect')
            .attr('x', d => -d.nw / 2).attr('y', d => -d.nh / 2)
            .attr('width', d => d.nw).attr('height', d => d.nh)
            .attr('rx', 6).attr('ry', 6)
            .attr('fill', d => d.color)
            .attr('stroke', d => d3.color(d.color) ? d3.color(d.color).brighter(0.8) : '#fff')
            .attr('stroke-width', 2);

        // game cover image fills the card
        node.append('image')
            .attr('href', d => `https://cdn.cloudflare.steamstatic.com/steam/apps/${d.id}/library_600x900.jpg`)
            .attr('x', d => -d.nw / 2).attr('y', d => -d.nh / 2)
            .attr('width', d => d.nw).attr('height', d => d.nh)
            .attr('preserveAspectRatio', 'xMidYMid slice')
            .attr('clip-path', d => `url(#clip-${d.id})`);

        // no-genre cluster setup
        const hasData = Object.keys(dataMap).length > 0;
        const clusterX = W * 0.12;
        const clusterY = H * 0.88;
        const noDataCount = nodes.filter(n => n.labels.length === 0).length;

        // simulation 

        // spread top genres evenly in a circle around the canvas center.
        // each node is pulled toward its primary genre's target point.
        const genrePositions = {};
        topGenres.forEach((genre, i) => {
            const angle = (i / topGenres.length) * 2 * Math.PI - Math.PI / 2;
            const r = Math.min(W, H) * 0.22;
            genrePositions[genre] = {
                x: W / 2 + r * Math.cos(angle),
                y: H / 2 + r * Math.sin(angle)
            };
        });

        // primary label = first non-ubiquitous label that has a cluster position
        function primaryGenre(d) {
            for (const g of d.labels) {
                if (genrePositions[g] && !ubiquitous.has(g)) return g;
            }
            return null;
        }

        simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(edges).id(d => d.id).distance(200).strength(0.5))
            .force('charge', d3.forceManyBody().strength(-700))
            .force('center', d3.forceCenter(W / 2, H / 2).strength(0.04))
            .force('collide', d3.forceCollide(d => Math.sqrt(d.nw * d.nw + d.nh * d.nh) / 2 + 14).iterations(3))
            .force('clusterX', d3.forceX(d => {
                if (hasData && d.labels.length === 0) return clusterX;
                const pg = primaryGenre(d);
                return pg ? genrePositions[pg].x : W / 2;
            }).strength(d => {
                if (hasData && d.labels.length === 0) return 0.25;
                return primaryGenre(d) ? 0.25 : 0;
            }))
            .force('clusterY', d3.forceY(d => {
                if (hasData && d.labels.length === 0) return clusterY;
                const pg = primaryGenre(d);
                return pg ? genrePositions[pg].y : H / 2;
            }).strength(d => {
                if (hasData && d.labels.length === 0) return 0.25;
                return primaryGenre(d) ? 0.25 : 0;
            }))
            .alphaDecay(0.025)
            .on('tick', () => {
                link
                    .attr('x1', d => d.source.x)
                    .attr('y1', d => d.source.y)
                    .attr('x2', d => d.target.x)
                    .attr('y2', d => d.target.y);
                node
                    .attr('transform', d => `translate(${d.x},${d.y})`);
            });


            const legendEl = document.getElementById('legend');
        legendEl.innerHTML = `<h4>${dataLabel}</h4>`;

        topGenres.forEach(genre => {
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `<div class="legend-dot" style="background:${colorScale(genre)};"></div><span>${genre}</span>`;
            legendEl.appendChild(item);
        });

        // "Other / no data" entry
        const other = document.createElement('div');
        other.className = 'legend-item';
        other.innerHTML = `<div class="legend-dot" style="background:${FALLBACK_COLOR};"></div><span>Other / no data</span>`;
        legendEl.appendChild(other);

        legendEl.style.display = 'block';
    }

    document.getElementById('steam-id-input')
        .addEventListener('keydown', e => { if (e.key === 'Enter') loadGames(); });

    document.getElementById('group-by').addEventListener('change', async function() {
        if (!currentGames) return;
        const mode = this.value;
        if (simulation) simulation.stop();
        d3.select('#graph-container svg').remove();
        document.getElementById('legend').style.display = 'none';

        if (mode === 'genre') {
            renderGraph(currentGames, currentGenreMap, 'Genre');
        } else {
            if (!currentTagMap) {
                setStatus('Fetching tag data…');
                const top50 = currentGames.slice(0, 200).map(g => g.appid);
                try {
                    const res = await fetch('/get-tags', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ appids: top50 })
                    });
                    const data = await res.json();
                    currentTagMap = data.tags || {};
                } catch (_) { currentTagMap = {}; }
            }
            renderGraph(currentGames, currentTagMap, 'Tag');
        }
    });