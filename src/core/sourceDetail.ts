/** A declined full-detail request is not permission to silently load a reduced scene. */
export class FullSourceDetailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FullSourceDetailError';
  }
}
