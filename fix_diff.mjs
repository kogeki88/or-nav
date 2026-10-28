import fs from 'fs';

const content = fs.readFileSync('frontend/src/lib/standaloneEngine.ts', 'utf8');

const target = `              const elapsed = Math.max(1, Math.round(performance.now() - t0));
              let reply = "";
              if (isScrub) {
                reply = \`📋 Preference Card: \${card.procedure} (\${card.surgeon})\\n\\n\` +
                  \`• Suture Preferences: \${(card.sutures || []).join(", ")}\\n\` +
                  \`• Instrumentation: \${(card.instrumentation || []).join(", ")}\\n\` +
                  \`• Scrub Setup Notes: \${card.notes || "None"}\`;
              } else {
                reply = \`📋 Preference Card: \${card.procedure} (\${card.surgeon})\\n\\n\` +
                  \`• Room & Positioning: \${card.room || "Main OR"} | \${card.position || "Supine"}\\n\` +
                  \`• Skin Prep: \${card.prep || "Standard"}\\n\` +
                  \`• Circulator Safety Considerations: \${card.notes || "Standard"}\`;
              }
              return {
                reply_text: reply,
                routing_tier: "TIER_1_LOCAL_CSV",
                scrubbed_query: processedText,
                phi_detected: false,
                latency_ms: elapsed,
                coordinate_card: null,
                move_widget: null,
              };`;

const replacement = `              const elapsed = Math.max(1, Math.round(performance.now() - t0));
              return {
                reply_text: "Found preference card.",
                routing_tier: "TIER_1_LOCAL_CSV",
                scrubbed_query: processedText,
                phi_detected: false,
                latency_ms: elapsed,
                coordinate_card: null,
                move_widget: null,
                preferenceCard: card
              };`;

const newContent = content.replace(target, replacement);

fs.writeFileSync('frontend/src/lib/standaloneEngine.ts', newContent);
console.log("Done");
