'use client';

import { Suspense } from 'react';

import dynamic from 'next/dynamic';

// Import the game component with dynamic loading and disabled SSR
const Game = dynamic(() => import('@/components/Game'), {
  ssr: false,
  loading: () => <div className="flex h-[80vh] w-full items-center justify-center">Loading Game...</div>
});

export default function Home() {
  return (
    <div className="flex flex-col w-full h-[80vh]">
      <h1 className="text-2xl font-bold mb-4 text-center">Herding Cats</h1>
      <p className="text-center mb-4">
        Convince the NPCs to move to the target waypoint!
      </p>

      <Suspense fallback={<div className="flex-1 flex items-center justify-center">Loading...</div>}>
        <Game />
      </Suspense>
    </div>
  );
}