import type { LocalAudioTrack, RemoteAudioTrack } from "livekit-client";
import { z } from "zod";

const TenantIdSchema = z.string().regex(/^[a-zA-Z0-9_]+::[a-zA-Z0-9_]+$/, "Invalid tenant ID format. Expected facility_id::dept_id");

export class LiveKitAudioVisualizer {
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private animationFrameId: number | null = null;
  private track: LocalAudioTrack | RemoteAudioTrack | null = null;
  private tenantId: string | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new Error('Invalid canvas element provided');
    }
    this.canvasCtx = canvas.getContext('2d');
  }

  setTenantId(tenantId: string) {
    this.tenantId = TenantIdSchema.parse(tenantId);
  }

  getTenantId() {
    return this.tenantId;
  }

  start(track: LocalAudioTrack | RemoteAudioTrack) {
    if (!track || typeof track.on !== 'function') {
      throw new Error('Invalid audio track provided');
    }
    this.track = track;
    this.track.on('muted', this.handleMuted);

    const draw = () => {
      if (this.canvasCtx) {
        this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // Draw visualizer bars based on audio track frequencies
      }
      this.animationFrameId = requestAnimationFrame(draw);
    };
    this.animationFrameId = requestAnimationFrame(draw);
  }

  private handleMuted = () => {
    this.stop();
  };

  stop() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  disconnect() {
    if (this.track) {
      this.track.off('muted', this.handleMuted);
      this.track = null;
    }
    this.stop();
  }

  dispose() {
    this.disconnect();
    this.canvasCtx = null;
    this.tenantId = null;
  }
}
