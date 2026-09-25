export const halfDesaturate = (color, amount = 0.5) => {
  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;
  const grey = Math.round((red + green + blue) / 3);
  const mix = Math.max(0, Math.min(1, Number(amount) || 0));
  const blend = (channel) => Math.round(channel + (grey - channel) * mix);
  return (blend(red) << 16) |
    (blend(green) << 8) |
    blend(blue);
};

export const darken = (color, amount) =>
  (Math.round(((color >> 16) & 0xff) * amount) << 16) |
  (Math.round(((color >> 8) & 0xff) * amount) << 8) |
  Math.round((color & 0xff) * amount);

export const metalTint = (color, lives, desaturation = 0.5, damagedBrightness = 0.55) => {
  const desaturated = halfDesaturate(color, desaturation);
  return lives === 2 ? darken(desaturated, damagedBrightness) : desaturated;
};

// Authored normal minos in a trash pattern stay bright while losing roughly
// half their saturation: #ff0000 becomes #ff7777.
export const normalTrashTint = (color, desaturation = 0x77 / 0xff) => {
  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;
  const high = Math.max(red, green, blue);
  const amount = Math.max(0, Math.min(1, Number(desaturation) || 0));
  const lift = (channel) => Math.round(channel + (high - channel) * amount);
  return (lift(red) << 16) | (lift(green) << 8) | lift(blue);
};
