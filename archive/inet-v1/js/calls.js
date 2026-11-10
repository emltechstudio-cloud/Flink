const Calls = {
  pc: null,
  dataChannel: null,
  localStream: null,
  remoteStream: null,
  currentCall: null,
  callTimer: null,
  callStartTime: 0,
  isMuted: false,
  isVideoOff: false,
  isSpeakerOn: false,
  callLog: [],
  groupCallRoom: null,
  groupPCs: {},
  groupStreams: {},
  groupLocalStream: null,
  groupIsMuted: false,
  groupIsVideoOff: false,

  async init() {
    this.callLog = await Storage.getAll('call_log');
    this.renderLog();
  },

  // 1-on-1 Call
  async startCall(video = false) {
    const flinkNumber = Chat.currentFlinkNumber || Contacts.currentFlinkNumber;
    if (!flinkNumber) return;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: video ? { width: 640, height: 480 } : false
      });
    } catch (e) {
      UI.toast('Camera/mic access denied');
      return;
    }

    this.currentCall = { flinkNumber, video, type: 'outgoing', status: 'calling' };
    this.showCallScreen(flinkNumber, video, 'Calling...');
    this.addLogEntry(flinkNumber, video ? 'video' : 'audio', 'outgoing', 'calling');

    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    this.dataChannel = this.pc.createDataChannel('Flink-data');
    this.bindDataChannel(this.dataChannel);

    this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream));

    this.pc.ontrack = (e) => {
      this.remoteStream = e.streams[0];
      if (video) {
        this.showRemoteVideo(e.streams[0]);
      }
    };

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        API.send({ type: 'ice_candidate', target: flinkNumber, payload: { candidate: e.candidate } });
      }
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    API.send({ type: 'call_offer', target: flinkNumber, payload: { call_type: video ? 'video' : 'audio', sdp: offer.sdp } });
  },

  async receiveCallOffer(msg) {
    const flinkNumber = msg.from;
    const video = msg.payload.call_type === 'video';

    if (this.currentCall) {
      API.send({ type: 'call_busy', target: flinkNumber, payload: {} });
      return;
    }

    this.currentCall = { flinkNumber, video, type: 'incoming', status: 'ringing' };
    this.addLogEntry(flinkNumber, video ? 'video' : 'audio', 'incoming', 'ringing');

    UI.showModal('Incoming Call', `
      <div style="text-align:center;padding:24px;">
        <div class="list-item-avatar" style="width:80px;height:80px;font-size:32px;margin:0 auto 16px;">${Utils.getInitials(Contacts.getName(flinkNumber))}</div>
        <div style="font-size:20px;font-weight:600;margin-bottom:8px;">${Contacts.getName(flinkNumber)}</div>
        <div style="color:var(--text-secondary);">${video ? 'Video call' : 'Audio call'}</div>
      </div>
    `, [
      { label: 'Decline', class: 'danger', action: () => { this.rejectCall(flinkNumber); UI.hideModal(); } },
      { label: 'Accept', class: 'primary', action: () => { this.acceptCall(flinkNumber, video, msg.payload.sdp); UI.hideModal(); } }
    ]);
  },

  async acceptCall(flinkNumber, video, offerSdp) {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: video ? { width: 640, height: 480 } : false
      });
    } catch (e) {
      UI.toast('Camera/mic access denied');
      this.endCall();
      return;
    }

    this.currentCall.status = 'connected';
    this.showCallScreen(flinkNumber, video, 'Connected');
    this.startCallTimer();
    this.updateLogStatus('connected');

    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    this.pc.ondatachannel = (event) => this.bindDataChannel(event.channel);

    this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream));

    this.pc.ontrack = (e) => {
      this.remoteStream = e.streams[0];
      if (video) this.showRemoteVideo(e.streams[0]);
    };

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        API.send({ type: 'ice_candidate', target: flinkNumber, payload: { candidate: e.candidate } });
      }
    };

    await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offerSdp }));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    API.send({ type: 'call_answer', target: flinkNumber, payload: { sdp: answer.sdp } });
  },

  rejectCall(flinkNumber) {
    API.send({ type: 'call_end', target: flinkNumber, payload: {} });
    this.currentCall = null;
    this.updateLogStatus('rejected');
  },

  async handleCallAnswer(msg) {
    if (!this.pc || !this.currentCall) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.payload.sdp }));
    this.currentCall.status = 'connected';
    document.getElementById('call-status').textContent = 'Connected';
    this.startCallTimer();
    this.updateLogStatus('connected');
  },

  handleIceCandidate(msg) {
    if (!this.pc) return;
    this.pc.addIceCandidate(new RTCIceCandidate(msg.payload.candidate));
  },

  bindDataChannel(channel) {
    this.dataChannel = channel;
    channel.onopen = () => UI.toast('Peer connection ready');
    channel.onclose = () => { if (this.dataChannel === channel) this.dataChannel = null; };
    channel.onerror = () => UI.toast('Peer data connection unavailable');
    channel.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.kind === 'chat' && message.message) {
          await Chat.receiveMessage({ from: message.message.from, payload: message.message });
        } else if (message.kind === 'reaction') {
          this.showReactionBubble(message.value);
        }
      } catch (e) {
        console.warn('Invalid peer data message', e);
      }
    };
  },

  sendData(payload) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      UI.toast('Connect to the peer before sending messages or files');
      return false;
    }
    this.dataChannel.send(JSON.stringify(payload));
    return true;
  },

  handleCallEnd(msg) {
    this.endCall();
    UI.toast('Call ended');
  },

  handleCallBusy(msg) {
    this.endCall();
    UI.toast('User is busy');
    this.updateLogStatus('busy');
  },

  endCall() {
    if (this.currentCall && this.currentCall.status !== 'connected') {
      this.updateLogStatus('missed');
    } else if (this.currentCall) {
      this.updateLogStatus('ended');
    }

    if (this.dataChannel) { try { this.dataChannel.close(); } catch (e) {} this.dataChannel = null; }
    if (this.pc) { this.pc.close(); this.pc = null; }
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }
    this.remoteStream = null;
    this.stopCallTimer();
    this.currentCall = null;
    this.isMuted = false;
    this.isVideoOff = false;
    this.isSpeakerOn = false;

    if (UI.history.length > 0) UI.goBack();
    else { UI.showScreen('chats'); UI.showNav(true); }
  },

  showCallScreen(flinkNumber, video, status) {
    const name = Contacts.getName(flinkNumber);
    document.getElementById('call-avatar').textContent = Utils.getInitials(name);
    document.getElementById('call-name').textContent = name;
    document.getElementById('call-status').textContent = status;
    document.getElementById('call-timer').textContent = '';
    document.getElementById('call-video-grid').style.display = video ? 'grid' : 'none';
    document.getElementById('call-reactions').style.display = video ? 'flex' : 'none';

    if (video && this.localStream) {
      const grid = document.getElementById('call-video-grid');
      grid.innerHTML = `<div class="call-video-item"><video id="local-video" autoplay muted playsinline></video><div class="video-label">You</div></div>`;
      document.getElementById('local-video').srcObject = this.localStream;
    }

    UI.showScreen('call');
    UI.showNav(false);
  },

  showRemoteVideo(stream) {
    const grid = document.getElementById('call-video-grid');
    const name = Contacts.getName(this.currentCall.flinkNumber);
    grid.innerHTML += `<div class="call-video-item"><video id="remote-video" autoplay playsinline></video><div class="video-label">${name}</div></div>`;
    document.getElementById('remote-video').srcObject = stream;
    grid.className = 'call-video-grid video-2';
  },

  startCallTimer() {
    this.callStartTime = Date.now();
    this.callTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
      document.getElementById('call-timer').textContent = Utils.formatDuration(elapsed);
    }, 1000);
  },

  stopCallTimer() {
    clearInterval(this.callTimer);
  },

  toggleMute() {
    if (!this.localStream) return;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMuted);
    document.getElementById('call-mute-btn').classList.toggle('active', this.isMuted);
  },

  toggleVideo() {
    if (!this.localStream) return;
    this.isVideoOff = !this.isVideoOff;
    this.localStream.getVideoTracks().forEach(t => t.enabled = !this.isVideoOff);
    document.getElementById('call-video-btn').classList.toggle('active', this.isVideoOff);
  },

  toggleSpeaker() {
    this.isSpeakerOn = !this.isSpeakerOn;
    document.getElementById('call-speaker-btn').classList.toggle('active', this.isSpeakerOn);
  },

  sendReaction(type) {
    if (!this.currentCall) return;
    const reactions = { heart: '\u2764', thumbsup: '\uD83D\uDC4D', laugh: '\uD83D\uDE02', fire: '\uD83D\uDD25', clap: '\uD83D\uDC4F' };
    const emoji = reactions[type] || type;
    if (this.sendData({ kind: 'reaction', value: emoji })) this.showReactionBubble(emoji);
  },

  showReactionBubble(emoji) {
    const bubble = document.createElement('div');
    bubble.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);font-size:64px;animation:reactionPop 1s ease forwards;pointer-events:none;z-index:400;';
    bubble.textContent = emoji;
    document.body.appendChild(bubble);
    setTimeout(() => bubble.remove(), 1000);
  },

  // Group Calls
  async startGroupCall() {
    const g = Groups.list.find(x => x.id === Groups.currentId);
    if (!g) return;
    this.groupCallRoom = g.id;

    try {
      this.groupLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 320, height: 240 } });
    } catch (e) {
      UI.toast('Camera/mic access denied');
      return;
    }

    UI.showScreen('group-call');
    UI.showNav(false);
    document.getElementById('gc-title').textContent = g.name;
    document.getElementById('gc-members-count').textContent = '1 participant';

    // Join room via WS
    API.send({ type: 'gc_join', room: g.id, payload: {} });

    // Invite all members
    g.members.forEach(m => {
      if (m !== Auth.getProfile().flinkNumber) {
        API.send({ type: 'gc_invite', target: m, payload: { room: g.id } });
      }
    });

    this.renderGroupVideoGrid();
  },

  async joinGroupCall(room) {
    this.groupCallRoom = room;
    try {
      this.groupLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 320, height: 240 } });
    } catch (e) {
      UI.toast('Camera/mic access denied');
      return;
    }

    UI.showScreen('group-call');
    UI.showNav(false);
    document.getElementById('gc-title').textContent = 'Group Call';
    API.send({ type: 'gc_join', room, payload: {} });
    this.renderGroupVideoGrid();
  },

  renderGroupVideoGrid() {
    const grid = document.getElementById('gc-video-grid');
    const myPin = Auth.getProfile().flinkNumber;
    let html = `<div class="call-video-item"><video id="gc-local-video" autoplay muted playsinline></video><div class="video-label">You</div></div>`;

    Object.entries(this.groupStreams).forEach(([flinkNumber, stream]) => {
      const name = Contacts.getName(flinkNumber);
      html += `<div class="call-video-item"><video id="gc-video-${flinkNumber}" autoplay playsinline></video><div class="video-label">${name}</div></div>`;
    });

    grid.innerHTML = html;
    const count = 1 + Object.keys(this.groupStreams).length;
    grid.className = `call-video-grid video-${Math.min(count, 4)}`;
    document.getElementById('gc-members-count').textContent = `${count} participant${count > 1 ? 's' : ''}`;

    if (this.groupLocalStream) {
      const localVid = document.getElementById('gc-local-video');
      if (localVid) localVid.srcObject = this.groupLocalStream;
    }

    Object.entries(this.groupStreams).forEach(([flinkNumber, stream]) => {
      const vid = document.getElementById(`gc-video-${flinkNumber}`);
      if (vid) vid.srcObject = stream;
    });
  },

  handleGroupSignal(msg) {
    if (msg.type === 'gc_invite') {
      const room = msg.payload.room;
      const from = msg.from;
      UI.showModal('Group Call', `
        <div style="text-align:center;padding:16px;">
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">${Contacts.getName(from)} invited you</div>
          <div style="color:var(--text-secondary);">Join group call?</div>
        </div>
      `, [
        { label: 'Decline', class: 'secondary', action: () => UI.hideModal() },
        { label: 'Join', class: 'primary', action: () => { this.joinGroupCall(room); UI.hideModal(); } }
      ]);
    }
    if (msg.type === 'gc_members') {
      // Members list received
    }
    if (msg.type === 'gc_leave') {
      const flinkNumber = msg.from;
      if (this.groupStreams[flinkNumber]) {
        delete this.groupStreams[flinkNumber];
        if (this.groupPCs[flinkNumber]) { this.groupPCs[flinkNumber].close(); delete this.groupPCs[flinkNumber]; }
        this.renderGroupVideoGrid();
      }
    }
  },

  toggleGroupMute() {
    if (!this.groupLocalStream) return;
    this.groupIsMuted = !this.groupIsMuted;
    this.groupLocalStream.getAudioTracks().forEach(t => t.enabled = !this.groupIsMuted);
    document.getElementById('gc-mute-btn').classList.toggle('active', this.groupIsMuted);
  },

  toggleGroupVideo() {
    if (!this.groupLocalStream) return;
    this.groupIsVideoOff = !this.groupIsVideoOff;
    this.groupLocalStream.getVideoTracks().forEach(t => t.enabled = !this.groupIsVideoOff);
    document.getElementById('gc-video-btn').classList.toggle('active', this.groupIsVideoOff);
  },

  toggleGroupSpeaker() {
    this.isSpeakerOn = !this.isSpeakerOn;
    document.getElementById('gc-speaker-btn').classList.toggle('active', this.isSpeakerOn);
  },

  sendGroupReaction(type) {
    if (!this.groupCallRoom) return;
    const reactions = { heart: '\u2764', thumbsup: '\uD83D\uDC4D', laugh: '\uD83D\uDE02', fire: '\uD83D\uDD25', clap: '\uD83D\uDC4F' };
    const emoji = reactions[type] || type;
    API.send({ type: 'gc_reaction', room: this.groupCallRoom, payload: { reaction: emoji, from: Auth.getProfile().flinkNumber } });
    this.showReactionBubble(emoji);
  },

  leaveGroupCall() {
    if (this.groupCallRoom) {
      API.send({ type: 'gc_leave', room: this.groupCallRoom, payload: {} });
    }
    Object.values(this.groupPCs).forEach(pc => pc.close());
    this.groupPCs = {};
    if (this.groupLocalStream) { this.groupLocalStream.getTracks().forEach(t => t.stop()); this.groupLocalStream = null; }
    this.groupStreams = {};
    this.groupCallRoom = null;
    this.groupIsMuted = false;
    this.groupIsVideoOff = false;
    UI.goBack();
    UI.showNav(true);
  },

  // Call Log
  addLogEntry(flinkNumber, type, direction, status) {
    const entry = {
      id: Utils.generateId(),
      flinkNumber,
      type,
      direction,
      status,
      time: Date.now()
    };
    this.callLog.unshift(entry);
    Storage.set('call_log', entry);
    this.renderLog();
  },

  updateLogStatus(status) {
    if (this.callLog.length && this.callLog[0].status !== 'ended' && this.callLog[0].status !== 'rejected') {
      this.callLog[0].status = status;
      Storage.set('call_log', this.callLog[0]);
      this.renderLog();
    }
  },

  renderLog() {
    const el = document.getElementById('calls-list');
    if (!this.callLog.length) {
      el.innerHTML = '<div class="empty-state"><svg><use href="#icon-clock"/></svg><h3>No calls yet</h3><p>Your call history appears here</p></div>';
      return;
    }
    el.innerHTML = '<div class="list">' + this.callLog.map(c => {
      const name = Contacts.getName(c.flinkNumber);
      const iconClass = c.direction === 'incoming' ? (c.status === 'missed' ? 'missed' : 'incoming') : 'outgoing';
      const iconSvg = c.type === 'video' ? 'video' : 'phone';
      return `
      <div class="list-item call-log-item" onclick="Chat.open('${c.flinkNumber}')">
        <div class="call-log-icon ${iconClass}"><svg><use href="#icon-${iconSvg}"/></svg></div>
        <div class="list-item-info">
          <div class="list-item-title">${Utils.escapeHtml(name)}</div>
          <div class="list-item-subtitle">${c.direction} ${c.type} call ${c.status}</div>
        </div>
        <div class="list-item-meta">
          <div class="list-item-time">${Utils.formatTime(c.time)}</div>
        </div>
      </div>
    `}).join('') + '</div>';
  },

  renderCallLogScreen() {
    const el = document.getElementById('call-log-list');
    if (!this.callLog.length) {
      el.innerHTML = '<div class="empty-state"><svg><use href="#icon-clock"/></svg><h3>No calls</h3><p>Your call history is empty</p></div>';
      return;
    }
    el.innerHTML = '<div class="list">' + this.callLog.map(c => {
      const name = Contacts.getName(c.flinkNumber);
      const iconClass = c.direction === 'incoming' ? (c.status === 'missed' ? 'missed' : 'incoming') : 'outgoing';
      const iconSvg = c.type === 'video' ? 'video' : 'phone';
      return `
      <div class="list-item call-log-item">
        <div class="call-log-icon ${iconClass}"><svg><use href="#icon-${iconSvg}"/></svg></div>
        <div class="list-item-info">
          <div class="list-item-title">${Utils.escapeHtml(name)}</div>
          <div class="list-item-subtitle">${c.direction} ${c.type} call ${c.status}</div>
        </div>
        <div class="list-item-meta">
          <div class="list-item-time">${Utils.formatTime(c.time)}</div>
        </div>
      </div>
    `}).join('') + '</div>';
  },

  async clearLog() {
    if (!confirm('Clear all call history?')) return;
    await Storage.clear('call_log');
    this.callLog = [];
    this.renderLog();
    this.renderCallLogScreen();
    UI.toast('Call log cleared');
  }
};
