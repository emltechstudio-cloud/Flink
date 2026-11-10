const Media = {
  mediaRecorder: null,
  mediaStream: null,
  audioChunks: [],
  recordingStart: 0,
  recordingTimer: null,
  maxVoiceDuration: 600,
  maxVideoDuration: 180,
  maxFileSize: 10,
  currentAudio: null,
  currentAudioEl: null,

  showAttachMenu() {
    UI.showModal("Attach", `
      <div class="picker-grid">
        <div class="picker-item" onclick="Media.pickImage();UI.hideModal()"><svg><use href="#icon-camera"/></svg></div>
        <div class="picker-item" onclick="Media.pickVideo();UI.hideModal()"><svg><use href="#icon-video"/></svg></div>
        <div class="picker-item" onclick="Media.pickFile();UI.hideModal()"><svg><use href="#icon-file"/></svg></div>
      </div>
    `, []);
  },

  pickImage() { document.getElementById("image-input").click(); },
  pickVideo() { document.getElementById("video-input").click(); },
  pickFile() { document.getElementById("file-input").click(); },

  async handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > this.maxFileSize * 1024 * 1024) { UI.toast("Image too large (max 10MB)"); return; }
    let dataUrl = await Utils.fileToBase64(file);
    dataUrl = await Utils.compressImage(dataUrl);
    if (Chat.currentFlinkNumber) await Chat.sendMedia("image", dataUrl);
    else if (Groups.currentId) await Groups.sendMedia("image", dataUrl);
  },

  async handleVideoSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > this.maxFileSize * 1024 * 1024) { UI.toast("Video too large (max 10MB)"); return; }
    let dataUrl = await Utils.fileToBase64(file);
    dataUrl = await Utils.trimVideo(dataUrl, this.maxVideoDuration);
    if (Chat.currentFlinkNumber) await Chat.sendMedia("video", dataUrl);
    else if (Groups.currentId) await Groups.sendMedia("video", dataUrl);
  },

  async handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > this.maxFileSize * 1024 * 1024) { UI.toast("File too large (max 10MB)"); return; }
    const dataUrl = await Utils.fileToBase64(file);
    const extra = { fileName: file.name, fileSize: this.formatFileSize(file.size) };
    if (Chat.currentFlinkNumber) await Chat.sendMedia("file", dataUrl, extra);
    else if (Groups.currentId) await Groups.sendMedia("file", dataUrl, extra);
  },

  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  },

  async startVoiceNote() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaStream = stream;
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];
      this.recordingStart = Date.now();
      this.mediaRecorder.ondataavailable = e => this.audioChunks.push(e.data);
      this.mediaRecorder.onstop = () => {
        this.mediaStream?.getTracks().forEach(t => t.stop());
        this.mediaStream = null;
        void this.finishVoiceNote();
      };
      this.mediaRecorder.start();
      document.getElementById("recording-indicator").classList.add("active");
      this.recordingTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - this.recordingStart) / 1000);
        document.getElementById("recording-time").textContent = Utils.formatDuration(elapsed);
        if (elapsed >= this.maxVoiceDuration) this.stopVoiceNote();
      }, 1000);
    } catch (e) {
      UI.toast("Microphone access denied");
    }
  },

  stopVoiceNote() {
    if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") return;
    try { this.mediaRecorder.stop(); } catch (e) { console.warn("Voice recorder already stopped", e); }
    clearInterval(this.recordingTimer);
    this.recordingTimer = null;
    document.getElementById("recording-indicator").classList.remove("active");
  },

  async finishVoiceNote() {
    const blob = new Blob(this.audioChunks, { type: "audio/webm" });
    if (blob.size < 1000) return;
    const dataUrl = await Utils.blobToBase64(blob);
    if (Chat.currentFlinkNumber) await Chat.sendMedia("audio", dataUrl);
    else if (Groups.currentId) await Groups.sendMedia("audio", dataUrl);
  },

  showStickerPicker() {
    const stickers = ["\u2764","\u2728","\uD83D\uDC4D","\uD83D\uDE02","\uD83D\uDD25","\uD83D\uDC4F","\uD83C\uDF89","\uD83D\uDE4C","\uD83D\uDE0E","\uD83D\uDE0D","\uD83D\uDE2D","\uD83D\uDE21","\uD83D\uDE31","\uD83D\uDE05","\uD83E\uDD18","\u270C"];
    const stickerHTML = stickers.map(s => {
      try { return `<div class="sticker-item" onclick="Media.sendSticker(String.fromCodePoint(${s.replace(/\u/g, "0x").replace(/\uD83D\u/g, "0x1F").replace(/\uD83C\u/g, "0x1F").replace(/\uD83E\u/g, "0x1F").replace(/\u270C/g, "0x270C")}))">${s}</div>`; }
      catch(e) { return `<div class="sticker-item" onclick="Media.sendSticker('${s}')">${s}</div>`; }
    }).join("");
    UI.showModal("Stickers", `<div class="sticker-grid">${stickerHTML}</div>`, []);
  },

  async sendSticker(sticker) {
    UI.hideModal();
    if (Chat.currentFlinkNumber) await Chat.sendMedia("sticker", sticker);
    else if (Groups.currentId) await Groups.sendMedia("sticker", sticker);
  },

  playAudio(el, src) {
    if (this.currentAudio && !this.currentAudio.paused) {
      this.currentAudio.pause();
      if (this.currentAudioEl) this.currentAudioEl.querySelector("svg use").setAttribute("href", "#icon-play");
    }
    this.currentAudio = new Audio(src);
    this.currentAudioEl = el;
    el.querySelector("svg use").setAttribute("href", "#icon-pause");
    this.currentAudio.onended = () => {
      el.querySelector("svg use").setAttribute("href", "#icon-play");
    };
    this.currentAudio.ontimeupdate = () => {
      const pct = (this.currentAudio.currentTime / this.currentAudio.duration) * 100;
      el.querySelector(".message-audio-bar").style.width = pct + "%";
    };
    this.currentAudio.play();
  },

  openViewer(src, type) {
    const viewer = document.getElementById("media-viewer");
    const content = document.getElementById("media-viewer-content");
    content.innerHTML = type === "image" ? `<img src="${src}" alt="">` : `<video src="${src}" controls autoplay playsinline></video>`;
    viewer.classList.add("active");
  },

  closeViewer() {
    document.getElementById("media-viewer").classList.remove("active");
    document.getElementById("media-viewer-content").innerHTML = "";
  }
};
