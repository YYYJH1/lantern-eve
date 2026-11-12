import { type Camera, type CameraPort, type CameraPose, type Eye } from "./camera.ts";

/** What the camera of a show needs of the map: its camera, whether it draws and has the town on it, and a way to have it drawn again. */
export interface StageMap {
  readonly camera: Camera;
  /** The map draws and has a town to draw. */
  readonly staged: boolean;
  /** Asks for a frame at once. */
  redraw(): void;
}

/** The camera of the map as a show moves it: by the point it looks at and how close, and given back as it was. */
export class StageCamera implements CameraPort {
  constructor(private readonly map: StageMap) {}

  ready(): boolean {
    return this.map.staged;
  }

  pose(): CameraPose {
    return this.map.camera.pose();
  }

  restore(pose: CameraPose): void {
    this.map.camera.restore(pose);
    this.map.redraw();
  }

  eye(): Eye {
    const { camera } = this.map;
    const centre = camera.centre;
    return { x: centre.x, y: centre.y, zoom: camera.zoom / camera.fitScale };
  }

  town(): Eye {
    const centre = this.map.camera.townCentre;
    return { x: centre.x, y: centre.y, zoom: 1 };
  }

  look(eye: Eye): void {
    const { camera } = this.map;
    camera.lookAt(eye.x, eye.y, eye.zoom * camera.fitScale);
    this.map.redraw();
  }
}
