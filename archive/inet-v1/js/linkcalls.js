const LinkCalls = {
  roomId: null,
  isHost: false,
  localStream: null,
  peers: {},
  streams: {},
  isMuted: false,
  isVideoOff: false,
  pcConfig: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },

  showCreate() {
    this.roomId = this.generateRoomId();
    const url = `${window.location.origin}${window.location.pathname}?call=${this.roomId}`;
    document.getElementById("link-call-url").textContent = url;
    document.getElementById("link-call-qr").innerHTML = this.generateQR(url);
    UI.showScreen("link-call");
  },

  generateRoomId() {
    return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
  },

  generateQR(url) {
    // Simple QR placeholder using a grid pattern
    const size = 200;
    const cells = 25;
    const cellSize = size / cells;
    let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        if (Math.random() > 0.5) {
          svg += `<rect x="${x * cellSize}" y="${y * cellSize}" width="${cellSize}" height="${cellSize}" fill="var(--text)"/>`;
        }
      }
    }
    // Add finder patterns (corners)
    const fs = cellSize * 7;
    [[0,0],[cells-7,0],[0,cells-7]].forEach(([cx,cy]) => {
      svg += `<rect x="${cx*cellSize}" y="${cy*cellSize}" width="${fs}" height="${fs}" fill="var(--text)"/>`;
      svg += `<rect x="${(cx+1)*cellSize}" y="${(cy+1)*cellSize}" width="${fs-2*cellSize}" height="${fs-2*cellSize}" fill="var(--bg)"/>`;
      svg += `<rect x="${(cx+2)*cellSize}" y="${(cy+2)*cellSize}" width="${fs-4*cellSize}" height="${fs-4*cellSize}" fill="var(--text)"/>`;
    });
    svg += "</svg>";
    return svg;
  },

  copyLink() {
    const url = document.getElementById("link-call-url").textContent;
    Utils.copyToClipboard(url);
    UI.toast("Link copied");
  },

  shareLink() {
    const url = document.getElementById("link-call-url").textContent;
    if (navigator.share) {
      navigator.share({ title: "Join my Flink call", url });
    } else {
      this.copyLink();
    }
  },

  async startHost() {
    this.isHost = true;
    await this.startCall();
  },

  async joinFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("call");
    if (!room) return false;
    this.roomId = room;
    this.isHost = false;
    await this.startCall();
    return true;
  },

  async startCall() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: 640, height: 480 }
      });
    } catch (e) {
      UI.toast("Camera/mic access denied");
      return;
    }

    UI.showScreen("link-call-active");
    UI.showNav(false);
    document.getElementById("lc-status").textContent = this.isHost ? "Waiting for participants..." : "Joining call...";
    this.renderVideoGrid();

    // Use WebSocket for signaling even without SIM (anonymous mode)
    // For now, use a simple broadcast approach via a shared signaling channel
    this.setupSignaling();
  },

  setupSignaling() {
    // Simple peer discovery using BroadcastChannel (same browser) or WebSocket fallback
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("flink_link_call_" + this.roomId);
      this.channel.onmessage = (e) => this.handleSignal(e.data);
      this.channel.postMessage({ type: "join", from: this.getAnonymousId() });
    } else {
      // Fallback: use a simple polling mechanism or alert user
      document.getElementById("lc-status").textContent = "Share the link with others to start";
    }
  },

  getAnonymousId() {
    let id = localStorage.getItem("flink_anon_id");
    if (!id) {
      id = Math.random().toString(36).substring(2, 15);
      localStorage.setItem("flink_anon_id", id);
    }
    return id;
  },

  async handleSignal(data) {
    if (data.from === this.getAnonymousId()) return;

    if (data.type === "join") {
      // Create offer to new peer
      await this.createPeer(data.from, true);
    }
    if (data.type === "offer") {
      await this.handleOffer(data.from, data.sdp);
    }
    if (data.type === "answer") {
      await this.handleAnswer(data.from, data.sdp);
    }
    if (data.type === "ice") {
      await this.handleIce(data.from, data.candidate);
    }
    if (data.type === "reaction") {
      Calls.showReactionBubble(data.reaction);
    }
  },

  async createPeer(peerId, isInitiator) {
    const pc = new RTCPeerConnection(this.pcConfig);
    this.peers[peerId] = pc;

    this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));

    pc.ontrack = (e) => {
      this.streams[peerId] = e.streams[0];
      this.renderVideoGrid();
    };

    pc.onicecandidate = (e) => {
      if (e.candidate && this.channel) {
        this.channel.postMessage({ type: "ice", from: this.getAnonymousId(), to: peerId, candidate: e.candidate });
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (this.channel) {
        this.channel.postMessage({ type: "offer", from: this.getAnonymousId(), to: peerId, sdp: offer.sdp });
      }
    }
  },

  async handleOffer(peerId, sdp) {
    await this.createPeer(peerId, false);
    const pc = this.peers[peerId];
    await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (this.channel) {
      this.channel.postMessage({ type: "answer", from: this.getAnonymousId(), to: peerId, sdp: answer.sdp });
    }
  },

  async handleAnswer(peerId, sdp) {
    const pc = this.peers[peerId];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp }));
  },

  async handleIce(peerId, candidate) {
    const pc = this.peers[peerId];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  },

  renderVideoGrid() {
    const grid = document.getElementById("lc-video-grid");
    const count = 1 + Object.keys(this.streams).length;
    let html = `<div class="call-video-item"><video id="lc-local-video" autoplay muted playsinline></video><div class="video-label">You</div></div>`;

    Object.entries(this.streams).forEach(([id, stream]) => {
      html += `<div class="call-video-item"><video id="lc-video-${id}" autoplay playsinline></video><div class="video-label">Guest</div></div>`;
    });

    grid.innerHTML = html;
    grid.className = `call-video-grid video-${Math.min(count, 4)}`;

    if (this.localStream) {
      const vid = document.getElementById("lc-local-video");
      if (vid) vid.srcObject = this.localStream;
    }

    Object.entries(this.streams).forEach(([id, stream]) => {
      const vid = document.getElementById(`lc-video-${id}`);
      if (vid) vid.srcObject = stream;
    });

    document.getElementById("lc-status").textContent = `${count} participant${count > 1 ? "s" : ""}`;
  },

  toggleMute() {
    if (!this.localStream) return;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMuted);
    document.getElementById("lc-mute-btn").classList.toggle("active", this.isMuted);
  },

  toggleVideo() {
    if (!this.localStream) return;
    this.isVideoOff = !this.isVideoOff;
    this.localStream.getVideoTracks().forEach(t => t.enabled = !this.isVideoOff);
    document.getElementById("lc-video-btn").classList.toggle("active", this.isVideoOff);
  },

  sendReaction(type) {
    const reactions = { heart: "\u2764", thumbsup: "\uD83D\uDC4D", laugh: "\uD83D\uDE02", fire: "\uD83D\uDD25", clap: "\uD83D\uDC4F" };
    const emoji = reactions[type] || type;
    if (this.channel) {
      this.channel.postMessage({ type: "reaction", from: this.getAnonymousId(), reaction: emoji });
    }
    Calls.showReactionBubble(emoji);
  },

  endCall() {
    Object.values(this.peers).forEach(pc => pc.close());
    this.peers = {};
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }
    this.streams = {};
    if (this.channel) { this.channel.close(); this.channel = null; }
    this.roomId = null;
    this.isHost = false;
    this.isMuted = false;
    this.isVideoOff = false;

    // Clear URL params
    if (window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    UI.goBack();
    UI.showNav(true);
  }
};
