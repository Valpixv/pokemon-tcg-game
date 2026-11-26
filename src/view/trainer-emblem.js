export function drawBall(ctx, x, y, radius, cap = '#ed5053', shell = '#fff8df', ink = '#192f40') {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(radius, radius);
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = cap;
  ctx.beginPath();
  ctx.arc(0, 0, 1, Math.PI, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = .10;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, 2 * Math.PI);
  ctx.moveTo(-1, 0);
  ctx.lineTo(1, 0);
  ctx.stroke();
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.arc(0, 0, .27, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
