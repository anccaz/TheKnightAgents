// Home / splash screen: particle title, what the product is for, one button into the app.
import { ArrowRight } from 'lucide-react';
import ParticleText from '@/components/ParticleText';
import { Button } from '@/components/ui/button';

const POINTS = [
  ['Out of band', 'Runs outside your network, so it still works when the attacker owns email and chat.'],
  ['One room, in minutes', 'IT, fraud, legal and execs see the same live picture and the next step for their role.'],
  ['Proof built in', 'Every action is recorded as it happens, ready for regulators.'],
] as const;

export default function HomePage({ onEnter }: { onEnter: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center gap-8 px-4 py-10 text-center">
      <h1 className="sr-only">Knight Agent</h1>
      <div className="w-full font-heading text-white" style={{ height: 'clamp(160px, 30vw, 300px)' }} aria-hidden="true">
        <ParticleText
          text="KNIGHT AGENT"
          particleSize={2.2}
          density={4}
          color="currentColor"
          highlightColor="#38bcf6"
          highlightMode="motion"
          shape="circle"
          intro="gather"
          scatter={190}
          gatherDuration={1600}
          stagger={420}
          clickBurst
          burstStrength={1}
          pointerRepel={42}
          repelRadius={120}
          idleDrift={0.8}
          trigger="mount"
          fontSize="clamp(2.5rem, 10vw, 8rem)"
          fontWeight={800}
          fontFamily="inherit"
          glow
        />
      </div>

      <p className="max-w-2xl text-lg text-white sm:text-xl">
        The secure command center a bank's response team uses in the first hour of a cyber attack.
      </p>

      <ul className="grid w-full max-w-4xl gap-3 text-left sm:grid-cols-3">
        {POINTS.map(([title, text]) => (
          <li key={title} className="glass p-4">
            <div className="font-heading text-sm tracking-[0.2em] text-neon uppercase">{title}</div>
            <p className="mt-1 text-sm text-muted-foreground">{text}</p>
          </li>
        ))}
      </ul>

      <Button size="lg" onClick={onEnter} className="h-12 px-6 text-base" autoFocus>
        Enter command center <ArrowRight data-icon="inline-end" />
      </Button>
    </main>
  );
}
