const api = require('./request');

function login() {
  return new Promise((resolve, reject) => {
    wx.getUserProfile({
      desc: '用于完善个人信息',
      success(profileRes) {
        wx.login({
          success(loginRes) {
            api.post('/api/auth/login', {
              code: loginRes.code,
              nickname: profileRes.userInfo.nickName,
              avatarUrl: profileRes.userInfo.avatarUrl,
            }).then(res => {
              const app = getApp();
              app.globalData.token = res.data.token;
              app.globalData.userInfo = res.data.user;
              wx.setStorageSync('token', res.data.token);
              wx.setStorageSync('userInfo', res.data.user);
              resolve(res.data.user);
            }).catch(reject);
          },
          fail: reject,
        });
      },
      fail: reject,
    });
  });
}

module.exports = { login };
