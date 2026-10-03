// One media player (a car, TV or speaker). The game sends 'sync' messages a few times a second with what should be
// playing, where in the song it should be and how loud; this page makes it so and reports back.
const params = new URLSearchParams(location.search);
const RES = params.get('res') || 'mediaplayer';
const ID = params.get('id') || '';
const vid = document.getElementById('vid');
let cur = null;           // { url, kind: 'yt' | 'media', player, ready, infoSent, playingSent, target }

function post(name, data) {
    return fetch(`https://${RES}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).catch(() => {});
}
function report(kind, extra) { post('duiEvent', Object.assign({ id: ID, kind }, extra || {})); }

const YT_ERRORS = {
    2: 'That YouTube link is broken (the video ID is wrong).',
    5: "YouTube's player hit an error inside the game (error 5).",
    100: 'That YouTube video is private or was removed.',
    101: "That video's owner doesn't allow it to play outside YouTube. Try another upload of the song (lyric videos usually work).",
    150: "That video's owner doesn't allow it to play outside YouTube. Try another upload of the song (lyric videos usually work).",
    152: 'YouTube refused to play inside the game (error 152).',
    153: 'YouTube refused to play inside the game (error 153) - it needs the player page to come from a web address. Check Config.DuiUrl in the mediaplayer README.',
};
const MEDIA_ERRORS = {
    1: 'Playback was stopped.',
    2: "Couldn't download that link (network error).",
    3: "That file couldn't be decoded.",
    4: "That link isn't a playable audio / video file (it may be a web page). Use a direct .mp3 / stream link or YouTube.",
};

function ytId(url) {
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^(www|m|music)\./, '');
        if (host === 'youtu.be') return u.pathname.slice(1, 12) || null;
        if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
            if (u.searchParams.get('v')) return u.searchParams.get('v');
            const m = u.pathname.match(/^\/(shorts|live|embed|v)\/([\w-]{11})/);
            if (m) return m[2];
        }
    } catch (e) { /* not a url */ }
    return null;
}

function fileTitle(url) {
    try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '').replace(/\.[a-z0-9]{2,4}$/i, '') || url; } catch (e) { return url; }
}

/* ---------- YouTube API loading ---------- */
let ytReady = !!(window.YT && window.YT.Player);
const ytWaiters = [];
window.onYouTubeIframeAPIReady = () => { ytReady = true; ytWaiters.splice(0).forEach(fn => fn()); };
function whenYT(fn, failed) {
    if (ytReady) return fn();
    ytWaiters.push(fn);
    setTimeout(() => { if (!ytReady) failed(); }, 12000);
}

/* ---------- create / destroy ---------- */
function destroy() {
    if (!cur) return;
    if (cur.kind === 'yt') {
        try { cur.player && cur.player.destroy(); } catch (e) { /* already gone */ }
        const div = document.createElement('div'); div.id = 'yt';
        const old = document.getElementById('yt'); if (old) old.replaceWith(div); else document.body.prepend(div);
    } else {
        vid.pause(); vid.removeAttribute('src'); vid.load();
    }
    document.getElementById('card').style.display = 'none';
    cur = null;
}

function create(msg) {
    destroy();
    const id = ytId(msg.url);
    cur = { url: msg.url, kind: id ? 'yt' : 'media', ready: false, infoSent: false, playingSent: false, target: msg };
    const me = cur;
    if (id) {
        vid.style.display = 'none';
        whenYT(() => {
            if (cur !== me) return;
            const vars = { autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, playsinline: 1, rel: 0, start: Math.floor(msg.pos || 0) };
            if (/^https?:/.test(location.origin)) { vars.origin = location.origin; vars.widget_referrer = location.origin + '/'; }
            me.player = new YT.Player('yt', {
                width: '100%', height: '100%', videoId: id, playerVars: vars,
                events: {
                    onReady: () => { me.ready = true; apply(); },
                    onStateChange: (e) => {
                        if (e.data === YT.PlayerState.PLAYING && !me.playingSent) { me.playingSent = true; report('playing'); }
                        if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.CUED) sendInfo();
                    },
                    onError: (e) => report('error', { code: e.data, message: YT_ERRORS[e.data] || ('YouTube error ' + e.data + '.') }),
                },
            });
        }, () => { if (cur === me) report('error', { code: 'api', message: "YouTube's player couldn't load inside the game." }); });
    } else {
        vid.style.display = msg.video ? 'block' : 'none';
        vid.src = msg.url;
        vid.onloadedmetadata = () => { me.ready = true; sendInfo(); apply(); };
        vid.onplaying = () => { if (!me.playingSent) { me.playingSent = true; report('playing'); } showCard(); };
        vid.onerror = () => { const c = vid.error && vid.error.code; report('error', { code: c, message: MEDIA_ERRORS[c] || "That link couldn't be played." }); };
        vid.load();
    }
}

// TVs playing audio only (radio / mp3) show the title instead of a black screen
function showCard() {
    if (!cur || cur.kind !== 'media') return;
    const audioOnly = !vid.videoWidth;
    document.getElementById('card').style.display = audioOnly ? 'flex' : 'none';
    document.getElementById('cardTitle').textContent = fileTitle(cur.url);
}

function sendInfo() {
    if (!cur || cur.infoSent) return;
    let duration = 0, title = '';
    if (cur.kind === 'yt') {
        try {
            const data = cur.player.getVideoData() || {};
            title = data.title || '';
            duration = data.isLive ? 0 : (cur.player.getDuration() || 0);
        } catch (e) { return; }
        if (!title && !duration) return;
    } else {
        duration = isFinite(vid.duration) ? vid.duration : 0;
        title = fileTitle(cur.url);
    }
    cur.infoSent = true;
    report('info', { duration, title });
}

/* ---------- keep it where the game says ---------- */
function apply() {
    if (!cur || !cur.ready) return;
    const t = cur.target;
    const vol = Math.max(0, Math.min(1, t.volume || 0));
    if (cur.kind === 'yt') {
        const p = cur.player;
        try {
            p.setVolume(Math.round(vol * 100));
            if (vol > 0 && p.isMuted()) p.unMute();
            const dur = p.getDuration() || 0;
            const live = (p.getVideoData() || {}).isLive;
            if (!live && dur > 0 && Math.abs(p.getCurrentTime() - t.pos) > 2.5 && t.pos < dur - 1) p.seekTo(t.pos, true);
            const state = p.getPlayerState();
            if (t.paused && state === YT.PlayerState.PLAYING) p.pauseVideo();
            if (!t.paused && state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING && state !== YT.PlayerState.ENDED) p.playVideo();
        } catch (e) { /* player not ready yet */ }
    } else {
        vid.volume = vol;
        const dur = isFinite(vid.duration) ? vid.duration : 0;
        if (dur > 0 && Math.abs(vid.currentTime - t.pos) > 2.5 && t.pos < dur - 1) vid.currentTime = t.pos;
        if (t.paused && !vid.paused) vid.pause();
        if (!t.paused && vid.paused && !vid.ended) vid.play().catch(() => {});
        vid.style.display = t.video && vid.videoWidth ? 'block' : 'none';
        showCard();
    }
}

addEventListener('message', (ev) => {
    let msg = ev.data;
    if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch (e) { return; } }
    if (!msg || msg.type !== 'sync' || !msg.url) return;
    if (!cur || cur.url !== msg.url) create(msg);
    cur.target = msg;
    apply();
});
