Component({
  properties: { bars: { type: Array, value: [], observer() { this.draw(); } }, styleMode: { type: String, value: 'line', observer() { this.draw(); } } },
  lifetimes: { ready() { this.draw(); } },
  methods: {
    draw() {
      this.createSelectorQuery().select('.chart').fields({ node: true, size: true }, rect => {
        if (!rect?.node || !rect.width) return;
        const bars = this.data.bars || [], ctx = rect.node.getContext('2d'), width = rect.width, height = rect.height;
        const ratio = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
        rect.node.width = width * ratio; rect.node.height = height * ratio; ctx.scale(ratio, ratio);
        ctx.clearRect(0, 0, width, height);
        if (!bars.length) return;
        const top = 20, bottom = height - 20, left = 5, right = width - 48;
        const values = bars.flatMap(b => [b.low, b.high, b.ma5, b.ma20, b.ma60].filter(v => v != null).map(Number));
        const min = Math.min(...values), max = Math.max(...values), span = max - min || Math.max(max * 0.02, 1);
        const x = i => left + (i + 0.5) * (right - left) / bars.length, y = v => bottom - (Number(v) - min) / span * (bottom - top);
        ctx.font = '10px sans-serif';
        for (let i = 0; i < 4; i++) {
          const value = min + span * i / 3, yy = y(value);
          ctx.strokeStyle = '#e7ece8'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
          ctx.fillStyle = '#879189'; ctx.fillText(value.toFixed(2), right + 4, yy + 3);
        }
        if (this.data.styleMode === 'candle') {
          const body = Math.max(1, Math.min(7, (right - left) / bars.length * 0.65));
          bars.forEach((b, i) => {
            const color = Number(b.close) >= Number(b.open) ? '#17674d' : '#b33a3a';
            ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x(i), y(b.high)); ctx.lineTo(x(i), y(b.low)); ctx.stroke();
            ctx.fillRect(x(i) - body / 2, Math.min(y(b.open), y(b.close)), body, Math.max(1, Math.abs(y(b.open) - y(b.close))));
          });
        }
        const lines = this.data.styleMode === 'candle' ? [['ma5', '#c28b35'], ['ma20', '#328ba0'], ['ma60', '#9b65b6']] : [['close', '#17674d']];
        for (const [key, color] of lines) {
          ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.beginPath(); let started = false;
          bars.forEach((b, i) => { if (b[key] == null) { started = false; return; } if (started) ctx.lineTo(x(i), y(b[key])); else ctx.moveTo(x(i), y(b[key])); started = true; }); ctx.stroke();
        }
      }).exec();
    },
  },
});
