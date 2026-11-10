const Contacts = {
  list: [],
  currentFlinkNumber: null,

  async init() {
    this.list = await Storage.getAll('contacts');
    this.render();
  },

  render() {
    const el = document.getElementById('contacts-list');
    if (!this.list.length) {
      el.innerHTML = '<div class="empty-state"><svg><use href="#icon-contacts"/></svg><h3>No contacts</h3><p>Add contacts by their Flink flinkNumber</p></div>';
      return;
    }
    el.innerHTML = '<div class="list">' + this.list.map(c => `
      <div class="list-item" onclick="Contacts.openProfile('${c.flinkNumber}')">
        <div class="list-item-avatar">${Utils.getInitials(c.name)}</div>
        <div class="list-item-info">
          <div class="list-item-title">${Utils.escapeHtml(c.name)}</div>
          <div class="list-item-subtitle">${c.flinkNumber}</div>
        </div>
      </div>
    `).join('') + '</div>';
  },

  search(query) {
    const q = query.toLowerCase();
    const items = document.querySelectorAll('#contacts-list .list-item');
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(q) ? 'flex' : 'none';
    });
  },

  showAdd() {
    UI.showScreen('contact-add');
  },

  async add() {
    const flinkNumber = document.getElementById('add-contact-flinkNumber').value.trim();
    const name = document.getElementById('add-contact-name').value.trim();
    const bio = document.getElementById('add-contact-bio').value.trim();

    if (!flinkNumber || flinkNumber.length !== 6) { UI.toast('Enter a valid 6-digit flinkNumber'); return; }
    if (!name) { UI.toast('Enter a name'); return; }
    if (this.list.find(c => c.flinkNumber === flinkNumber)) { UI.toast('Contact already exists'); return; }

    const contact = { flinkNumber, name, bio, addedAt: Date.now() };
    await Storage.set('contacts', contact);
    this.list.push(contact);
    this.render();
    UI.toast('Contact added');
    UI.goBack();

    document.getElementById('add-contact-flinkNumber').value = '';
    document.getElementById('add-contact-name').value = '';
    document.getElementById('add-contact-bio').value = '';
  },

  openProfile(flinkNumber) {
    const c = this.list.find(x => x.flinkNumber === flinkNumber);
    if (!c) return;
    this.currentFlinkNumber = flinkNumber;
    document.getElementById('profile-avatar').textContent = Utils.getInitials(c.name);
    document.getElementById('profile-name').textContent = c.name;
    document.getElementById('profile-flinkNumber').textContent = c.flinkNumber;
    document.getElementById('profile-bio').textContent = c.bio || 'No bio';
    UI.showScreen('contact-profile');
  },

  showEdit() {
    const c = this.list.find(x => x.flinkNumber === this.currentFlinkNumber);
    if (!c) return;
    UI.showModal('Edit Contact', `
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:13px;color:var(--text-muted);margin-bottom:6px;">Name</label>
        <input type="text" class="input" id="edit-contact-name" value="${Utils.escapeHtml(c.name)}">
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:13px;color:var(--text-muted);margin-bottom:6px;">Bio</label>
        <input type="text" class="input" id="edit-contact-bio" value="${Utils.escapeHtml(c.bio || '')}">
      </div>
    `, [
      { label: 'Save', class: 'primary', action: () => this.saveEdit() },
      { label: 'Cancel', class: 'secondary', action: () => UI.hideModal() }
    ]);
  },

  async saveEdit() {
    const name = document.getElementById('edit-contact-name').value.trim();
    const bio = document.getElementById('edit-contact-bio').value.trim();
    if (!name) return;
    const c = this.list.find(x => x.flinkNumber === this.currentFlinkNumber);
    if (c) {
      c.name = name;
      c.bio = bio;
      await Storage.set('contacts', c);
      this.render();
      this.openProfile(this.currentFlinkNumber);
      UI.hideModal();
      UI.toast('Contact updated');
    }
  },

  async deleteCurrent() {
    if (!confirm('Delete this contact?')) return;
    await Storage.delete('contacts', this.currentFlinkNumber);
    this.list = this.list.filter(c => c.flinkNumber !== this.currentFlinkNumber);
    this.render();
    UI.toast('Contact deleted');
    UI.goBack();
  },

  getName(flinkNumber) {
    const c = this.list.find(x => x.flinkNumber === flinkNumber);
    return c ? c.name : flinkNumber;
  },

  get(flinkNumber) {
    return this.list.find(x => x.flinkNumber === flinkNumber);
  }
};
