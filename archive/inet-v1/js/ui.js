const UI = {
  history: [],
  currentTab: 'chats',

  init() {
    this.setupAutoResize();
    this.setupKeyboard();
  },

  setupAutoResize() {
    document.querySelectorAll('textarea').forEach(ta => {
      ta.addEventListener('input', () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
      });
    });
  },

  setupKeyboard() {
    // Handle virtual keyboard on mobile
    const meta = document.querySelector('meta[name="viewport"]');
    const original = meta.content;
    window.addEventListener('resize', () => {
      if (window.innerHeight < 500) {
        meta.content = original + ', height=' + window.innerHeight;
      } else {
        meta.content = original;
      }
    });
  },

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById('screen-' + id);
    if (screen) {
      screen.classList.add('active');
      this.history.push(id);
    }
    // Hide/show nav based on screen
    const hideNav = ['chat', 'group-chat', 'call', 'group-call', 'link-call', 'link-call-active', 'contact-profile', 'contact-add', 'group-create', 'group-info', 'call-log', 'settings'].includes(id);
    this.showNav(!hideNav);
  },

  goBack() {
    this.history.pop();
    const prev = this.history.pop() || this.currentTab;
    this.showScreen(prev);
  },

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');
    this.showScreen(tab);
  },

  showNav(show) {
    const nav = document.getElementById('bottom-nav');
    if (nav) nav.style.display = show ? 'flex' : 'none';
  },

  showModal(title, body, buttons) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = body;
    const footer = document.getElementById('modal-footer');
    footer.innerHTML = buttons.map(b =>
      `<button class="modal-btn ${b.class}" onclick="(${b.action.toString})()">${b.label}</button>`
    ).join('');
    document.getElementById('modal-overlay').classList.add('active');
  },

  hideModal() {
    document.getElementById('modal-overlay').classList.remove('active');
  },

  closeModal(e) {
    if (e.target === document.getElementById('modal-overlay')) this.hideModal();
  },

  showChatMenu() {
    UI.showModal('Chat Options', `
      <div class="settings-item" onclick="Contacts.openProfile('${Chat.currentFlinkNumber}');UI.hideModal()">
        <div class="settings-item-left"><svg><use href="#icon-info"/></svg><div class="settings-item-label">Contact Info</div></div>
      </div>
      <div class="settings-item" onclick="Calls.startCall(false);UI.hideModal()">
        <div class="settings-item-left"><svg><use href="#icon-phone"/></svg><div class="settings-item-label">Audio Call</div></div>
      </div>
      <div class="settings-item" onclick="Calls.startCall(true);UI.hideModal()">
        <div class="settings-item-left"><svg><use href="#icon-video"/></svg><div class="settings-item-label">Video Call</div></div>
      </div>
    `, []);
  },

  showGroupMenu() {
    UI.showModal('Group Options', `
      <div class="settings-item" onclick="Groups.showInfo();UI.hideModal()">
        <div class="settings-item-left"><svg><use href="#icon-info"/></svg><div class="settings-item-label">Group Info</div></div>
      </div>
      <div class="settings-item" onclick="Calls.startGroupCall();UI.hideModal()">
        <div class="settings-item-left"><svg><use href="#icon-video"/></svg><div class="settings-item-label">Group Call</div></div>
      </div>
    `, []);
  },

  toast(message, duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
};
