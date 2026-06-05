const api = require('../../utils/request');

const SPECIES = ['dog', 'cat', 'other'];

Page({
  data: {
    petId: null,
    name: '', speciesOptions: ['dog', 'cat', 'other'], speciesIndex: 0,
    breed: '', age: '', weight: '', notes: ''
  },
  async onLoad(options) {
    if (options.id) {
      this.setData({ petId: options.id });
      const res = await api.get('/api/pets');
      const pet = (res.data || []).find(p => p.id === parseInt(options.id));
      if (pet) {
        this.setData({
          name: pet.name,
          speciesIndex: SPECIES.indexOf(pet.species),
          breed: pet.breed || '',
          age: String(pet.age || ''),
          weight: String(pet.weight || ''),
          notes: pet.notes || ''
        });
      }
    }
  },
  onNameInput(e) { this.setData({ name: e.detail.value }); },
  onSpeciesChange(e) { this.setData({ speciesIndex: e.detail.value }); },
  onBreedInput(e) { this.setData({ breed: e.detail.value }); },
  onAgeInput(e) { this.setData({ age: e.detail.value }); },
  onWeightInput(e) { this.setData({ weight: e.detail.value }); },
  onNotesInput(e) { this.setData({ notes: e.detail.value }); },
  async onSave() {
    const { petId, name, speciesIndex, breed, age, weight, notes } = this.data;
    if (!name) return wx.showToast({ title: '请填写名字', icon: 'none' });
    const payload = {
      name, species: SPECIES[speciesIndex], breed,
      age: parseInt(age) || null, weight: parseFloat(weight) || null, notes
    };
    if (petId) { await api.put(`/api/pets/${petId}`, payload); }
    else { await api.post('/api/pets', payload); }
    wx.showToast({ title: '保存成功' });
    setTimeout(() => wx.navigateBack(), 1000);
  },
  async onDelete() {
    const result = await wx.showModal({ title: '确认删除', content: '删除后不可恢复' });
    if (!result.confirm) return;
    await api.del(`/api/pets/${this.data.petId}`);
    wx.showToast({ title: '已删除' });
    setTimeout(() => wx.navigateBack(), 1000);
  }
});
