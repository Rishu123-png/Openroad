import { InputAction } from "../../input/InputActions";
import { OrbitCameraRig } from "../camera/OrbitCameraRig";
import { createDaylight, type Daylight } from "../lighting/createDaylight";
import { createWorld, type World } from "../world/createWorld";
import { GameBase } from "./GameBase";

export type { GameOptions, GameStats } from "./GameBase";

/**
 * The fictional test district with an inspection camera. It is not a map of
 * any real place; the real district is DistrictGame.
 */
export class Game extends GameBase {
  declare readonly world: World;
  declare readonly daylight: Daylight;
  declare readonly cameraRig: OrbitCameraRig;

  protected build(): void {
    const self = this as { -readonly [K in "world" | "daylight" | "cameraRig"]: Game[K] };
    self.daylight = createDaylight(this.scene);
    self.world = createWorld(this.scene);
    this.daylight.setStaticShadowCasters(this.world.shadowCasters);
    self.cameraRig = new OrbitCameraRig(this.scene);
    if (this.options.canvas) this.cameraRig.attach(this.options.canvas);
    this.cleanups.push(
      this.options.input.onPressed(InputAction.CameraChange, () => this.cameraRig.nextPreset()),
      this.options.input.onPressed(InputAction.Reset, () => this.cameraRig.reset()),
    );
  }

  protected update(deltaSeconds: number): void {
    this.cameraRig.update(deltaSeconds);
  }

  protected get viewName(): string {
    return this.cameraRig.presetName;
  }

  protected disposeWorld(): void {
    this.cameraRig.dispose();
  }
}
