Component({
  data: { visible: false },
  lifetimes: {
    attached() { this._unsubscribe = getApp().subscribeWelcome(visible => this.setData({ visible })); },
    detached() { if (this._unsubscribe) this._unsubscribe(); },
  },
  methods: { blockTouch() {}, confirm() { getApp().confirmWelcome(); } },
});
