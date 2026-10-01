import {useRef} from "react";

/** Anslutningskoden, en ruta per siffra med strecket förtryckt.
 *
 * Ett vanligt textfält säger ingenting om hur lång koden är eller om strecket
 * ska skrivas. Rutorna säger båda utan ett ord: sex fält, delade tre och tre.
 *
 * Rutorna är strikta - bara siffror - medan servern tar emot koden hur den än
 * skrivs. Det är samma regel från två håll, och därför kan den som klistrar in
 * "123-456", "123 456" eller "123456" göra det: inklistringen rensas här, och
 * skulle någon ändå skicka en annan skrivning godtar servern den.
 */
export function CodeBoxes({value, onChange, label}: {value: string; onChange: (code: string) => void; label: string}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.replace(/\D/g, "").slice(0, 6).padEnd(6, " ");

  const write = (next: string) => onChange(next.replace(/\s/g, ""));

  const setAt = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, "");
    if (typed.length > 1) return spread(typed, index);
    const next = digits.split("");
    next[index] = typed || " ";
    write(next.join(""));
    if (typed && index < 5) boxes.current[index + 1]?.focus();
  };

  const spread = (raw: string, from: number) => {
    const typed = raw.replace(/\D/g, "").slice(0, 6 - from);
    const next = digits.split("");
    typed.split("").forEach((digit, offset) => { next[from + offset] = digit; });
    write(next.join(""));
    const last = Math.min(from + typed.length, 5);
    boxes.current[last]?.focus();
  };

  return (
    <div className="code-boxes" role="group" aria-label={label}>
      {[0, 1, 2].map((index) => <Box key={index} index={index} digits={digits} boxes={boxes} setAt={setAt} spread={spread} label={label} />)}
      <span className="code-boxes-dash" aria-hidden="true">–</span>
      {[3, 4, 5].map((index) => <Box key={index} index={index} digits={digits} boxes={boxes} setAt={setAt} spread={spread} label={label} />)}
    </div>
  );
}

function Box({index, digits, boxes, setAt, spread, label}: {
  index: number; digits: string; boxes: React.MutableRefObject<(HTMLInputElement | null)[]>;
  setAt: (index: number, raw: string) => void; spread: (raw: string, from: number) => void; label: string;
}) {
  return (
    <input
      ref={(element) => { boxes.current[index] = element; }}
      value={digits[index].trim()}
      onChange={(event) => setAt(index, event.target.value)}
      onPaste={(event) => { event.preventDefault(); spread(event.clipboardData.getData("text"), 0); }}
      onFocus={(event) => event.target.select()}
      onKeyDown={(event) => {
        if (event.key === "Backspace" && !digits[index].trim() && index > 0) {
          event.preventDefault();
          setAt(index - 1, "");
          boxes.current[index - 1]?.focus();
        } else if (event.key === "ArrowLeft" && index > 0) boxes.current[index - 1]?.focus();
        else if (event.key === "ArrowRight" && index < 5) boxes.current[index + 1]?.focus();
      }}
      inputMode="numeric"
      maxLength={1}
      autoComplete="one-time-code"
      aria-label={`${label}: ${index + 1}/6`}
    />
  );
}
