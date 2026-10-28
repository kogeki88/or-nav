1. **The Persistent Bottom Quick-Action Bar (`QuickActionBar.tsx`)**
   - Create a new component `frontend/src/components/QuickActionBar.tsx`.
   - It will have 4 buttons: "🎙️ Voice", "🚨 Peer Q&A", "📦 Quick Add", and "⚡ Quests".
   - Modify `frontend/src/app/page.tsx` to handle these states:
     - Voice: Call `startPTT()` (same as `Omnibar`).
     - Peer Q&A: `setPeerQnAOpen(true)`
     - Quick Add: `setResourceModalOpen(true)`
     - Quests: `setProfileModalTab("rewards")` and `setProfileModalOpen(true)`
   - Integrate `QuickActionBar` directly above the `<Omnibar />` component in `frontend/src/app/page.tsx`.

2. **Verify QuickActionBar Integration**
   - Run `read_file` or bash `cat` to verify that `frontend/src/components/QuickActionBar.tsx` was created successfully and `frontend/src/app/page.tsx` was updated with the integration and is syntactically valid.

3. **High-Contrast "Surgical Scrub Mode" Glare Shield**
   - Update `frontend/src/app/globals.css` to use the contrast profile. Set global `--background: #000000;` and `background-color: #000000;`.
   - Update `frontend/src/components/CoordinateCard.tsx`:
     - Change container styling to improve contrast (`bg-black` or darker variants instead of `bg-zinc-900/90`).
     - Increase contrast on badges, suture gauge chips, and status pills (20% higher contrast ratios). e.g., use `text-[#f4f4f5]` instead of `text-zinc-400/500`, and deeper surgical emerald `#10b981` / cyan `#06b6d4` where appropriate for highlights.
     - Specifically update `bg-emerald-950/40 text-emerald-200` to be sharper against true black.

4. **Verify High-Contrast Changes**
   - Read the updated files (`globals.css` and `CoordinateCard.tsx`) to verify the styling changes were applied successfully.

5. **Swipeable Preference Card Carousel (`PreferenceCardCarousel.tsx`)**
   - Create a new component `frontend/src/components/PreferenceCardCarousel.tsx`.
   - It will render a horizontal scroll/swipe container (native css `snap-x` or similar) containing 3 cards (Setup & Positioning, Instruments & Trays, Sutures & Closures).
   - In `frontend/src/components/ChatCanvas.tsx`, update `MessageItem` to include `preferenceCard?: any`.
   - Modify `frontend/src/lib/standaloneEngine.ts` to attach `preferenceCard: card` object inside the response instead of just generating the raw text string.
   - Modify `frontend/src/components/ChatCanvas.tsx` to render `<PreferenceCardCarousel card={msg.preferenceCard} />` when `msg.preferenceCard` exists.

6. **Verify Preference Card Integration**
   - Read `PreferenceCardCarousel.tsx`, `standaloneEngine.ts`, and `ChatCanvas.tsx` to confirm that the logic was cleanly written and correctly imported.

7. **Run Tests and Verification Checks**
   - Run `npm run build` and `npm run lint` in the `frontend` directory to ensure the changes are correct and have not introduced regressions.

8. **Pre-commit step**
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.

9. **Submit**
   - Commit and submit the code.
