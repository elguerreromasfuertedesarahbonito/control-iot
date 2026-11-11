/** La última entrada manual aceptada conserva la propiedad de su liberación. */
export class ManualInput {
  constructor({ move, stop }) {
    this.move = move;
    this.stop = stop;
    this.owner = null;
    this.resets = new Map();
  }

  register(source, reset) { this.resets.set(source, reset); }

  unregister(source) {
    if (this.owner === source) this.owner = null;
    this.resets.delete(source);
  }

  request(source, command) {
    if (!command || this.move(command) !== true) return false;
    this.owner = source;
    for (const [other, reset] of this.resets) if (other !== source) reset();
    return true;
  }

  release(source) {
    if (this.owner !== source) return false;
    this.owner = null;
    this.stop();
    return true;
  }

  clear() {
    this.owner = null;
    for (const reset of this.resets.values()) reset();
  }
}
