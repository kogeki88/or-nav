export class SpeechSynthesisQueue {
    private queue: SpeechSynthesisUtterance[] = [];
    private muted: boolean = false;
    private isPlaying: boolean = false;
    private readonly STORAGE_KEY = 'ornav_tts_muted';

    constructor() {
        if (typeof window !== 'undefined' && window.localStorage) {
            const stored = window.localStorage.getItem(this.STORAGE_KEY);
            if (stored === 'true') {
                this.muted = true;
            }
        }
    }

    public isMuted(): boolean {
        return this.muted;
    }

    public setMuted(muted: boolean): void {
        this.muted = muted;
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(this.STORAGE_KEY, String(muted));
        }

        if (muted && typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
            this.queue = [];
            this.isPlaying = false;
        }
    }

    public speak(text: string, options?: { urgent?: boolean }): void {
        if (this.muted) {
            return;
        }

        if (typeof window === 'undefined' || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
            return;
        }

        const utterance = new window.SpeechSynthesisUtterance(text);

        utterance.onend = () => {
            this.isPlaying = false;
            this.playNext();
        };

        utterance.onerror = () => {
            this.isPlaying = false;
            this.playNext();
        };

        if (options?.urgent) {
            window.speechSynthesis.cancel();
            this.queue = [];
            this.isPlaying = true;
            window.speechSynthesis.speak(utterance);
        } else {
            this.queue.push(utterance);
            if (!this.isPlaying) {
                this.playNext();
            }
        }
    }

    private playNext(): void {
        if (this.muted || this.queue.length === 0) {
            return;
        }

        if (typeof window === 'undefined' || !window.speechSynthesis) {
            return;
        }

        const nextUtterance = this.queue.shift();
        if (nextUtterance) {
            this.isPlaying = true;
            window.speechSynthesis.speak(nextUtterance);
        }
    }
}
