const api = require('../../utils/request');

Page({
  data: {
    providerId: null,
    shopName: '', address: '', pricePerDay: '', description: '',
    acceptedSpecies: [], isAvailable: true
  },
  async onLoad() {
    const meRes = await api.get('/api/users/me');
    const me = meRes.data;
    if (me.role !== 'provider') {
      wx.showToast({ title: '请先成为服务商', icon: 'none' });
      return;
    }
    const listRes = await api.get('/api/providers');
    const myShop = (listRes.data || []).find(p => p.user_id === me.id);
    if (myShop) {
      this.setData({
        providerId: myShop.id,
        shopName: myShop.shop_name,
        address: myShop.address || '',
        pricePerDay: String(myShop.price_per_day),
        description: myShop.description || '',
        acceptedSpecies: myShop.accepted_species || [],
        isAvailable: myShop.is_available,
      });
    }
  },
  onShopNameInput(e) { this.setData({ shopName: e.detail.value }); },
  onAddressInput(e) { this.setData({ address: e.detail.value }); },
  onPriceInput(e) { this.setData({ pricePerDay: e.detail.value }); },
  onDescInput(e) { this.setData({ description: e.detail.value }); },
  onAvailableChange(e) { this.setData({ isAvailable: e.detail.value }); },
  toggleSpecies(e) {
    const val = e.currentTarget.dataset.val;
    const list = [...this.data.acceptedSpecies];
    const idx = list.indexOf(val);
    if (idx >= 0) list.splice(idx, 1); else list.push(val);
    this.setData({ acceptedSpecies: list });
  },
  async onSave() {
    const { providerId, shopName, address, pricePerDay, description, acceptedSpecies, isAvailable } = this.data;
    if (!shopName) return wx.showToast({ title: '请填写店铺名称', icon: 'none' });
    const payload = {
      shopName, address, pricePerDay: parseFloat(pricePerDay) || 0,
      description, acceptedSpecies, isAvailable
    };
    if (providerId) {
      await api.put(`/api/providers/${providerId}`, payload);
    } else {
      await api.post('/api/providers', payload);
    }
    wx.showToast({ title: '保存成功' });
    setTimeout(() => wx.navigateBack(), 1000);
  }
});
