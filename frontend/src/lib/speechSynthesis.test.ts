import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import 'jsdom-global/register.js';

// TDD: We expect a SpeechSynthesisQueue class to be exported.
// Since the file doesn't exist yet, we define the expected interface locally
// to allow the test file to compile, but tests will fail when checking against the actual module.
interface SpeechSynthesisQueueExpected {
    new(): any;
    speak(text: string, options?: { urgent?: boolean }): void;
    setMuted(muted: boolean): void;
    isMuted(): boolean;
}

describe('SpeechSynthesisQueue', () => {
    let mockSpeechSynthesis: unknown;
    let spokenUtterances: unknown[];
    let cancelled: boolean;
    let localStorageData: Record<string, string>;

    beforeEach(() => {
        spokenUtterances = [];
        cancelled = false;
        localStorageData = {};

        mockSpeechSynthesis = {
            speak: (utterance: unknown) => {
                spokenUtterances.push(utterance);
                if (utterance && typeof utterance === 'object' && 'onend' in utterance && typeof (utterance as any).onend === 'function') {
                   // defer to simulate async utterance
                   setTimeout(() => (utterance as any).onend(), 0);
                }
            },
            cancel: () => {
                cancelled = true;
                // in reality cancel stops current speech
                if (spokenUtterances.length > 0) {
                     // remove the last spoken utterance as it was cancelled
                }
            },
            speaking: false,
            pending: false,
            paused: false,
        };

        const mockLocalStorage = {
            getItem: (key: string) => localStorageData[key] || null,
            setItem: (key: string, value: string) => { localStorageData[key] = value; },
            removeItem: (key: string) => { delete localStorageData[key]; }
        };

        (global as { window?: unknown }).window = {
            speechSynthesis: mockSpeechSynthesis,
            SpeechSynthesisUtterance: class {
                text: string;
                rate: number = 1;
                pitch: number = 1;
                constructor(text: string) {
                    this.text = text;
                }
            },
            localStorage: mockLocalStorage
        };
        (global as { localStorage?: unknown }).localStorage = mockLocalStorage;
        (global as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance = ((global as { window?: unknown }).window as any).SpeechSynthesisUtterance;
    });

    it('prioritizes urgent clinical alerts over regular queries', async () => {
        let QueueClass;
        try {
            const mod = await import('./speechSynthesis.js?bust=' + Date.now());
            QueueClass = mod.SpeechSynthesisQueue;
        } catch (e) {
            assert.fail('SpeechSynthesisQueue not implemented');
            return;
        }

        const queue = new QueueClass();

        queue.speak('Regular message 1');
        // assume regular message 1 starts speaking synchronously

        queue.speak('Urgent clinical alert', { urgent: true });
        // urgent should cancel the ongoing regular message

        queue.speak('Regular message 2'); // goes to queue

        // Assert that the cancel was called to interrupt 'Regular message 1'
        assert.strictEqual(cancelled, true);

        // The urgent message should be in the utterances list, possibly as the second item
        // depending on implementation, but it definitely should be spoken.
        const utteranceTexts = spokenUtterances.map(u => (u as any).text);
        assert.ok(utteranceTexts.includes('Urgent clinical alert'), 'Urgent alert was not spoken');
    });

    it('mute state prevents utterance execution', async () => {
        let QueueClass;
        try {
            const mod = await import('./speechSynthesis.js?bust=' + Date.now());
            QueueClass = mod.SpeechSynthesisQueue;
        } catch (e) {
            assert.fail('SpeechSynthesisQueue not implemented');
            return;
        }

        const queue = new QueueClass();
        queue.setMuted(true);
        cancelled = false;
        spokenUtterances.length = 0; // Clear cross-test leakage!

        queue.speak('This should not be spoken');

        assert.strictEqual(spokenUtterances.length, 0);
        assert.strictEqual(cancelled, false); // No extra cancel when already muted
    });

    it('mute persistence is loaded and saved', async () => {
        let QueueClass;
        try {
            const mod = await import('./speechSynthesis.js?bust=' + Date.now());
            QueueClass = mod.SpeechSynthesisQueue;
        } catch (e) {
            assert.fail('SpeechSynthesisQueue not implemented');
            return;
        }

        // Simulate existing mute state in persistence
        localStorageData['ornav_tts_muted'] = 'true';

        const queue1 = new QueueClass();
        assert.strictEqual(queue1.isMuted(), true);

        // Change state and verify persistence
        queue1.setMuted(false);
        assert.strictEqual(localStorageData['ornav_tts_muted'], 'false');

        const queue2 = new QueueClass();
        assert.strictEqual(queue2.isMuted(), false);
    });
});
