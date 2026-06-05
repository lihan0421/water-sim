const api = require('../../utils/request');

Page({
  data: {
    pets: [], petNames: [], petIndex: 0,
    startDate: '', endDate: '', days: 0, pricePerDay: 0, totalPrice: 0,
    note: '', loading: false
  },
  onLoad(options) {
    this.providerId = options.providerId;
    this.setData({ pricePerDay: parseFloat(options.pricePerDay) });
    this.loadPets();
  },
  async loadPets() {
    const res = await api.get('/api/pets');
    const pets = res.data || [];
    this.setData({ pets, petNames: pets.map(p => `${p.name}(${p.species})`) });
  },
  onPetChange(e) { this.setData({ petIndex: parseInt(e.detail.value) }); },
  onStartChange(e) { this.setData({ startDate: e.detail.value }); this.calcPrice(); },
  onEndChange(e) { this.setData({ endDate: e.detail.value }); this.calcPrice(); },
  calcPrice() {
    const { startDate, endDate, pricePerDay } = this.data;
    if (!startDate || !endDate) return;
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000);
    if (days > 0) this.setData({ days, totalPrice: (days * pricePerDay).toFixed(2) });
  },
  onNoteInput(e) { this.setData({ note: e.detail.value }); },
  async onSubmit() {
    const { pets, petIndex, startDate, endDate, note, days } = this.data;
    if (!pets.length) return wx.showToast({ title: '请先添加宠物', icon: 'none' });
    if (!startDate || !endDate) return wx.showToast({ title: '请选择日期', icon: 'none' });
    if (days <= 0) return wx.showToast({ title: '结束日期需晚于开始日期', icon: 'none' });
    this.setData({ loading: true });
    try {
      await api.post('/api/orders', {
        providerId: parseInt(this.providerId),
        petId: pets[petIndex].id,
        startDate, endDate, note
      });
      wx.showToast({ title: '预约成功！' });
      setTimeout(() => wx.navigateBack(), 1500);
    } catch {
      wx.showToast({ title: '预约失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
