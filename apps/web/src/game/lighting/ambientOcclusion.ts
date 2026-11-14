import type { Camera } from "@babylonjs/core/Cameras/camera";
import "@babylonjs/core/Rendering/prePassRendererSceneComponent";
import "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Screen-space ambient occlusion: darkens creases where walls meet the ground
 * and each other. Used on the "high" graphics setting only; it costs a
 * half-resolution pass every frame.
 */
export function createAmbientOcclusion(scene: Scene, camera: Camera): { dispose(): void } {
  const pipeline = new SSAO2RenderingPipeline("ambientOcclusion", scene, { ssaoRatio: 0.5, blurRatio: 1 }, [camera]);
  pipeline.radius = 1.6;
  pipeline.totalStrength = 0.9;
  pipeline.base = 0.15;
  pipeline.samples = 12;
  pipeline.maxZ = 180;
  pipeline.minZAspect = 0.5;
  pipeline.expensiveBlur = false;
  return { dispose: () => pipeline.dispose() };
}
