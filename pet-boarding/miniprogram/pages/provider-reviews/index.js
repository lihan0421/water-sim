const api = require('../../utils/request');

Page({
  data: { reviews: [], replyDraft: {} },
  async onLoad() {
    const meRes = await api.get('/api/users/me');
    const listRes = await api.get('/api/providers');
    const myShop = (listRes.data || []).find(p => p.user_id === meRes.data.id);
    if (!myShop) return;
    this.providerId = myShop.id;
    this.loadReviews();
  },
  async loadReviews() {
    const res = await api.get(`/api/reviews/provider/${this.providerId}`);
    this.setData({ reviews: res.data || [], replyDraft: {} });
  },
  onReplyInput(e) {
    const id = e.currentTarget.dataset.id;
    const draft = { ...this.data.replyDraft, [id]: e.detail.value };
    this.setData({ replyDraft: draft });
  },
  async onReply(e) {
    const id = e.currentTarget.dataset.id;
    const reply = this.data.replyDraft[id];
    if (!reply) return wx.showToast({ title: '请填写回复', icon: 'none' });
    await api.put(`/api/reviews/${id}/reply`, { reply });
    wx.showToast({ title: '回复成功' });
    this.loadReviews();
  }
});
