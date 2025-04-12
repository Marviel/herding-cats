'use client';

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import { readStreamableValue } from 'ai/rsc';
import * as THREE from 'three';

import { processNPCInteraction } from '@/app/actions';
import {
  Html,
  OrbitControls,
} from '@react-three/drei';
import {
  Canvas,
  useFrame,
  useThree,
} from '@react-three/fiber';

// Types
interface Position {
    x: number;
    z: number;
}

interface Waypoint {
    id: number;
    name: string;
    position: Position;
    isTarget: boolean;
}

interface NPC {
    id: number;
    position: Position;
    color: string;
    currentWaypoint: number | null;
    targetWaypoint: number | null;
    speed: number;
    isInteracting: boolean;
    dwellTime: number;
    lastWaypoint: number | null;
    personality: string;
    conversationHistory: {
        role: 'user' | 'assistant';
        content: string;
    }[];
    aiResponse: {
        thinking?: string[];
        result?: {
            message: string;
            newTarget: number | null;
        };
    } | null;
    isTyping: boolean;
    isConvinced: boolean;
    convincedTimer: number;
    snarkyComment: string | null;
}

// Helper functions
const calculateDistance = (pos1: Position, pos2: Position): number => {
    return Math.sqrt(Math.pow(pos2.x - pos1.x, 2) + Math.pow(pos2.z - pos1.z, 2));
};

// Player character component
function Player({
    position,
    setPosition,
    disabled
}: {
    position: Position;
    setPosition: (pos: Position) => void;
    disabled: boolean;
}) {
    const meshRef = useRef<THREE.Mesh>(null);
    const [keys, setKeys] = useState({
        forward: false,
        backward: false,
        left: false,
        right: false,
    });

    const speed = 0.1;

    // Handle keyboard input
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore keyboard input when disabled (during NPC interaction)
            if (disabled) return;

            if (e.key === 'w' || e.key === 'ArrowUp') setKeys((keys) => ({ ...keys, forward: true }));
            if (e.key === 's' || e.key === 'ArrowDown') setKeys((keys) => ({ ...keys, backward: true }));
            if (e.key === 'a' || e.key === 'ArrowLeft') setKeys((keys) => ({ ...keys, left: true }));
            if (e.key === 'd' || e.key === 'ArrowRight') setKeys((keys) => ({ ...keys, right: true }));
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'w' || e.key === 'ArrowUp') setKeys((keys) => ({ ...keys, forward: false }));
            if (e.key === 's' || e.key === 'ArrowDown') setKeys((keys) => ({ ...keys, backward: false }));
            if (e.key === 'a' || e.key === 'ArrowLeft') setKeys((keys) => ({ ...keys, left: false }));
            if (e.key === 'd' || e.key === 'ArrowRight') setKeys((keys) => ({ ...keys, right: false }));
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [disabled]);

    // Handle movement
    useFrame(() => {
        if (!meshRef.current) return;

        let newPos = { ...position };

        if (keys.forward) newPos.z -= speed;
        if (keys.backward) newPos.z += speed;
        if (keys.left) newPos.x -= speed;
        if (keys.right) newPos.x += speed;

        // Apply the new position
        setPosition(newPos);

        meshRef.current.position.x = newPos.x;
        meshRef.current.position.z = newPos.z;
    });

    return (
        <mesh ref={meshRef} position={[position.x, 0.5, position.z]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="green" />
        </mesh>
    );
}

// NPC component
function NPC({
    npc,
    waypoints,
    onInteract,
    onSendMessage
}: {
    npc: NPC;
    waypoints: Waypoint[];
    onInteract: (id: number) => void;
    onSendMessage: (id: number, message: string) => void;
}) {
    const meshRef = useRef<THREE.Mesh>(null);
    const [message, setMessage] = useState('');

    // Handle NPC movement
    useFrame((_, delta) => {
        if (!meshRef.current || npc.isInteracting) return;

        // If we need to choose a waypoint
        if (npc.targetWaypoint === null) {
            return; // This will be handled in the parent component
        }

        // If at waypoint, check dwell time
        const targetWaypoint = waypoints.find(wp => wp.id === npc.targetWaypoint);
        if (!targetWaypoint) return;

        const distance = calculateDistance(npc.position, targetWaypoint.position);

        // If very close to waypoint
        if (distance < 0.5) {
            // If just arrived, update position to be exactly at waypoint
            if (distance > 0.1) {
                npc.position.x = targetWaypoint.position.x;
                npc.position.z = targetWaypoint.position.z;
                meshRef.current.position.x = targetWaypoint.position.x;
                meshRef.current.position.z = targetWaypoint.position.z;
            }
            return; // Don't move, dwell time is handled in the parent component
        }

        // Otherwise, move towards target waypoint
        const directionX = targetWaypoint.position.x - npc.position.x;
        const directionZ = targetWaypoint.position.z - npc.position.z;
        const dist = Math.sqrt(directionX * directionX + directionZ * directionZ);

        // Normalize direction
        const normalizedX = directionX / dist;
        const normalizedZ = directionZ / dist;

        npc.position.x += normalizedX * npc.speed;
        npc.position.z += normalizedZ * npc.speed;

        // Update mesh position
        meshRef.current.position.x = npc.position.x;
        meshRef.current.position.z = npc.position.z;
    });

    // Handle clicks on the NPC
    const handleClick = (e: any) => {
        e.stopPropagation();
        onInteract(npc.id);
    };

    // Handle sending a message
    const handleSendMessage = (e: React.FormEvent) => {
        e.preventDefault();
        if (message.trim()) {
            onSendMessage(npc.id, message);
            setMessage('');
        }
    };

    return (
        <group>
            <mesh
                ref={meshRef}
                position={[npc.position.x, 0.5, npc.position.z]}
                onClick={handleClick}
            >
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial
                    color={npc.color}
                    emissive={npc.isInteracting ? "white" : (npc.isConvinced ? "yellow" : "black")}
                    emissiveIntensity={npc.isInteracting ? 0.5 : (npc.isConvinced ? 0.3 : 0)}
                />
            </mesh>

            {/* Convinced timer display */}
            {npc.isConvinced && (
                <Html position={[npc.position.x, 2, npc.position.z]} center>
                    <div className="bg-black bg-opacity-80 text-white p-2 rounded">
                        <p className="text-center font-bold">
                            Staying for: {Math.ceil(npc.convincedTimer)}s
                        </p>
                        {npc.snarkyComment && (
                            <p className="text-xs text-yellow-400 mt-1">{npc.snarkyComment}</p>
                        )}
                    </div>
                </Html>
            )}

            {/* Existing interaction UI */}
            {npc.isInteracting && (
                <Html position={[npc.position.x, 2, npc.position.z]} center>
                    <div className="bg-black bg-opacity-80 text-white p-3 rounded w-96 max-h-96 overflow-y-auto">
                        <p className="text-center font-bold mb-2">Talking to NPC {npc.id}</p>

                        {/* Display conversation history */}
                        <div className="mb-3 max-h-40 overflow-y-auto">
                            {npc.conversationHistory.map((msg, idx) => (
                                <div key={idx} className={`mb-2 ${msg.role === 'user' ? 'text-green-400' : 'text-blue-400'}`}>
                                    <span className="font-bold">{msg.role === 'user' ? 'You' : 'NPC'}:</span> {msg.content}
                                </div>
                            ))}

                            {/* Show AI response if available */}
                            {npc.aiResponse?.result?.message && (
                                <div className="mb-2 text-blue-400">
                                    <span className="font-bold">NPC:</span> {npc.aiResponse.result.message}
                                </div>
                            )}

                            {/* Show typing indicator */}
                            {npc.isTyping && (
                                <div className="mb-2 text-gray-400">
                                    <span className="font-bold">NPC:</span> <span className="animate-pulse">...</span>
                                </div>
                            )}

                            {/* Show AI thoughts when debugging */}
                            {npc.aiResponse?.thinking && process.env.NODE_ENV === 'development' && (
                                <div className="mt-4 p-2 bg-gray-800 rounded text-xs">
                                    <p className="font-bold text-gray-400">Thinking:</p>
                                    <ul className="list-disc pl-4">
                                        {npc.aiResponse.thinking.map((thought, i) => (
                                            <li key={i} className="text-gray-400">{thought}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>

                        {/* Input form */}
                        <form onSubmit={handleSendMessage} className="flex flex-col gap-2">
                            <input
                                type="text"
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder="Type your message..."
                                className="p-2 rounded bg-gray-800 text-white w-full"
                                autoFocus
                                disabled={npc.isTyping}
                            />
                            <div className="flex justify-between">
                                <button
                                    type="submit"
                                    className={`bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded ${npc.isTyping ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    disabled={npc.isTyping}
                                >
                                    Send
                                </button>
                                <button
                                    type="button"
                                    className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-1 rounded"
                                    onClick={() => onInteract(npc.id)}
                                >
                                    Close
                                </button>
                            </div>
                        </form>
                    </div>
                </Html>
            )}
        </group>
    );
}

// Waypoint component
function Waypoint({ waypoint }: { waypoint: Waypoint }) {
    return (
        <group position={[waypoint.position.x, 0, waypoint.position.z]}>
            <mesh position={[0, 0.25, 0]}>
                <cylinderGeometry args={[1, 1, 0.5, 32]} />
                <meshStandardMaterial color={waypoint.isTarget ? "#ffff00" : "#aaaaaa"} />
            </mesh>
            <Html position={[0, 1.5, 0]} center>
                <div className="text-white bg-black bg-opacity-50 px-2 py-1 rounded text-sm font-bold">
                    {waypoint.name}{waypoint.isTarget ? " (Target)" : ""}
                </div>
            </Html>
        </group>
    );
}

// Ground component
function Ground({ onClick }: { onClick?: () => void }) {
    return (
        <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0, 0]}
            receiveShadow
            onClick={onClick}
        >
            <planeGeometry args={[50, 50]} />
            <meshStandardMaterial color="#336633" />
        </mesh>
    );
}

// Camera that follows the player
function CameraController({ playerPosition }: { playerPosition: Position }) {
    const { camera } = useThree();

    useFrame(() => {
        camera.position.x = playerPosition.x;
        camera.position.y = 15; // Height above the player
        camera.position.z = playerPosition.z + 5; // Slightly behind player
        camera.lookAt(playerPosition.x, 0, playerPosition.z);
    });

    return null;
}

// Game state manager component that runs within Canvas context
function GameManager({
    npcs,
    setNpcs,
    waypoints
}: {
    npcs: NPC[];
    setNpcs: React.Dispatch<React.SetStateAction<NPC[]>>;
    waypoints: Waypoint[];
}) {
    // Collection of possible snarky comments
    const snarkyComments = [
        "I've wasted enough time here.",
        "This place is boring. I'm out!",
        "30 seconds of my life I'll never get back.",
        "Okay, I came here. Happy now?",
        "That's enough of this place.",
        "Time's up! I'm going somewhere more interesting.",
        "I've fulfilled my obligation. Bye!",
        "The things I do for others...",
    ];

    // Update NPC state including waypoint selection, dwelling, and convinced timer
    useFrame((_, delta) => {
        setNpcs(currentNpcs =>
            currentNpcs.map(npc => {
                // Skip updates if interacting
                if (npc.isInteracting) return npc;

                // Handle convinced state
                if (npc.isConvinced) {
                    // Update the timer
                    const newTimer = npc.convincedTimer - delta;

                    // If timer expired
                    if (newTimer <= 0) {
                        // Choose a random snarky comment
                        const randomComment = snarkyComments[Math.floor(Math.random() * snarkyComments.length)];

                        // Choose a new random waypoint that isn't the target
                        const availableWaypoints = waypoints.filter(w => !w.isTarget);
                        const randomWaypoint = availableWaypoints[Math.floor(Math.random() * availableWaypoints.length)];

                        return {
                            ...npc,
                            isConvinced: false,
                            convincedTimer: 0,
                            snarkyComment: null,
                            targetWaypoint: randomWaypoint.id,
                            lastWaypoint: npc.targetWaypoint,
                            currentWaypoint: null,
                            // Display snarky comment briefly before leaving
                            conversationHistory: [
                                ...npc.conversationHistory,
                                {
                                    role: 'assistant' as const,
                                    content: randomComment
                                }
                            ]
                        };
                    }

                    // Just update the timer
                    return {
                        ...npc,
                        convincedTimer: newTimer,
                        // Show a snarky comment when there's 5 seconds left
                        snarkyComment: newTimer <= 5 && !npc.snarkyComment
                            ? "I'm not staying here much longer..."
                            : npc.snarkyComment
                    };
                }

                // Regular waypoint behavior (check if at waypoint and need to wait)
                if (npc.targetWaypoint !== null) {
                    const targetWaypoint = waypoints.find(w => w.id === npc.targetWaypoint);
                    if (targetWaypoint && calculateDistance(npc.position, targetWaypoint.position) < 0.5) {
                        // Check if NPC has reached the target waypoint
                        if (targetWaypoint.isTarget) {
                            return {
                                ...npc,
                                isConvinced: true,
                                convincedTimer: 30, // 30 seconds timer
                                snarkyComment: null,
                                dwellTime: 0
                            };
                        }

                        // Normal waypoint dwelling logic
                        // If at waypoint, increase dwell time
                        const newDwellTime = npc.dwellTime + delta;

                        // If dwell time is complete (2 seconds), choose new waypoint
                        if (newDwellTime >= 2) {
                            // Choose a new random waypoint that isn't the target and isn't the current one
                            const availableWaypoints = waypoints.filter(w =>
                                !w.isTarget &&
                                w.id !== npc.targetWaypoint &&
                                w.id !== npc.lastWaypoint
                            );

                            // If somehow no waypoints are available, allow repeating
                            const waypointsToChooseFrom = availableWaypoints.length > 0
                                ? availableWaypoints
                                : waypoints.filter(w => !w.isTarget && w.id !== npc.targetWaypoint);

                            const randomWaypoint = waypointsToChooseFrom[Math.floor(Math.random() * waypointsToChooseFrom.length)];

                            return {
                                ...npc,
                                dwellTime: 0,
                                currentWaypoint: npc.targetWaypoint,
                                lastWaypoint: npc.targetWaypoint,
                                targetWaypoint: randomWaypoint.id
                            };
                        }

                        // Still dwelling
                        return {
                            ...npc,
                            dwellTime: newDwellTime
                        };
                    }
                }

                // Not at waypoint or not dwelling
                return npc;
            })
        );
    });

    return null;
}

// Main game component
export default function Game() {
    const [playerPosition, setPlayerPosition] = useState<Position>({ x: 0, z: 0 });

    // Track game state
    const [gameStartTime, setGameStartTime] = useState<number>(Date.now());
    const [gameWon, setGameWon] = useState<boolean>(false);
    const [gameTime, setGameTime] = useState<number>(0);

    // Game state
    const [waypoints, setWaypoints] = useState<Waypoint[]>([
        { id: 1, name: "Light Pole", position: { x: 10, z: 10 }, isTarget: true },
        { id: 2, name: "Bush", position: { x: -10, z: 10 }, isTarget: false },
        { id: 3, name: "Bench", position: { x: 10, z: -10 }, isTarget: false },
        { id: 4, name: "Fountain", position: { x: -10, z: -10 }, isTarget: false },
    ]);

    const [npcs, setNpcs] = useState<NPC[]>([
        {
            id: 1,
            position: { x: 5, z: 5 },
            color: "red",
            currentWaypoint: null,
            targetWaypoint: null,
            speed: 0.05,
            isInteracting: false,
            dwellTime: 0,
            lastWaypoint: null,
            personality: "You're impatient and easily annoyed, but you can be convinced if someone offers a logical reason.",
            conversationHistory: [],
            aiResponse: null,
            isTyping: false,
            isConvinced: false,
            convincedTimer: 0,
            snarkyComment: null
        },
        {
            id: 2,
            position: { x: -5, z: 5 },
            color: "blue",
            currentWaypoint: null,
            targetWaypoint: null,
            speed: 0.03,
            isInteracting: false,
            dwellTime: 0,
            lastWaypoint: null,
            personality: "You're curious and easily distracted. You love interesting stories and adventures.",
            conversationHistory: [],
            aiResponse: null,
            isTyping: false,
            isConvinced: false,
            convincedTimer: 0,
            snarkyComment: null
        },
    ]);

    // Initialize NPCs with waypoints
    useEffect(() => {
        setNpcs(currentNpcs =>
            currentNpcs.map(npc => {
                // If already has a target, keep it
                if (npc.targetWaypoint !== null) return npc;

                // Choose a random waypoint that isn't the target
                const availableWaypoints = waypoints.filter(w => !w.isTarget);
                const randomWaypoint = availableWaypoints[Math.floor(Math.random() * availableWaypoints.length)];

                return {
                    ...npc,
                    targetWaypoint: randomWaypoint.id
                };
            })
        );
    }, [waypoints]);

    // Handle NPC interaction
    const handleNpcInteraction = (npcId: number) => {
        setNpcs(currentNpcs =>
            currentNpcs.map(npc =>
                npc.id === npcId
                    ? { ...npc, isInteracting: !npc.isInteracting }
                    : { ...npc, isInteracting: false }
            )
        );
    };

    // Handle messages to NPC
    const handleSendMessage = async (npcId: number, message: string) => {
        // Find the target NPC and waypoint
        const npc = npcs.find(n => n.id === npcId);
        const targetWaypoint = waypoints.find(w => w.isTarget);

        if (!npc || !targetWaypoint) return;

        // Add user message to conversation history
        setNpcs(currentNpcs =>
            currentNpcs.map(n =>
                n.id === npcId
                    ? {
                        ...n,
                        conversationHistory: [...n.conversationHistory, { role: 'user', content: message }],
                        isTyping: true
                    }
                    : n
            )
        );

        // Prepare NPC state for the AI
        const npcState = {
            id: npc.id,
            personality: npc.personality,
            currentPosition: npc.position,
            targetWaypoint: npc.targetWaypoint,
            conversationHistory: npc.conversationHistory
        };

        try {
            // Call the AI function
            const { object, conversationHistory } = await processNPCInteraction(
                message,
                npcState,
                waypoints,
                targetWaypoint.id
            );

            // Stream the response
            for await (const partialObject of readStreamableValue(object)) {
                setNpcs(currentNpcs =>
                    currentNpcs.map(n =>
                        n.id === npcId
                            ? { ...n, aiResponse: partialObject, isTyping: !partialObject?.result?.message }
                            : n
                    )
                );
            }

            // When streaming is complete, apply any target changes
            setNpcs(currentNpcs =>
                currentNpcs.map(n => {
                    if (n.id !== npcId) return n;

                    // Fix the potential undefined issue with newTarget
                    const newTarget = n.aiResponse?.result?.newTarget;

                    // Add the AI response to conversation history
                    const updatedHistory = [
                        ...conversationHistory,
                        {
                            role: 'assistant' as const,
                            content: n.aiResponse?.result?.message || "I'm not sure how to respond to that."
                        }
                    ];

                    return {
                        ...n,
                        targetWaypoint: typeof newTarget === 'number' ? newTarget : n.targetWaypoint,
                        conversationHistory: updatedHistory,
                        isTyping: false
                    };
                })
            );

        } catch (error) {
            console.error("Error in AI interaction:", error);

            // Handle error case
            setNpcs(currentNpcs =>
                currentNpcs.map(n =>
                    n.id === npcId
                        ? {
                            ...n,
                            conversationHistory: [
                                ...n.conversationHistory,
                                {
                                    role: 'assistant',
                                    content: "Sorry, I'm having trouble understanding. Can you try again?"
                                }
                            ],
                            isTyping: false
                        }
                        : n
                )
            );
        }
    };

    // Clear all interactions when clicking the ground
    const handleGroundClick = () => {
        setNpcs(currentNpcs =>
            currentNpcs.map(npc => ({ ...npc, isInteracting: false }))
        );
    };

    // Check for win condition
    useEffect(() => {
        // If already won, don't check again
        if (gameWon) return;

        // Check if all NPCs are at the target waypoint
        const targetWaypoint = waypoints.find(w => w.isTarget);
        if (!targetWaypoint) return;

        const allNpcsAtTarget = npcs.every(npc => {
            // If convinced and at target, count as at target
            return npc.isConvinced &&
                calculateDistance(npc.position, targetWaypoint.position) < 1.5;
        });

        if (allNpcsAtTarget && npcs.length > 0) {
            // Calculate time taken
            const timeElapsed = Math.floor((Date.now() - gameStartTime) / 1000);
            setGameTime(timeElapsed);
            setGameWon(true);
        }
    }, [npcs, waypoints, gameWon, gameStartTime]);

    // Restart the game
    const handleRestart = () => {
        // Reset game state
        setGameWon(false);
        setGameStartTime(Date.now());

        // Reset NPCs
        setNpcs(npcs.map(npc => ({
            ...npc,
            position: {
                x: Math.random() * 20 - 10,
                z: Math.random() * 20 - 10
            },
            currentWaypoint: null,
            targetWaypoint: null,
            isInteracting: false,
            isConvinced: false,
            convincedTimer: 0,
            dwellTime: 0,
            lastWaypoint: null,
            snarkyComment: null,
            conversationHistory: [],
            aiResponse: null,
            isTyping: false
        })));

        // Reset player position
        setPlayerPosition({ x: 0, z: 0 });
    };

    return (
        <div className="w-full h-full">
            <Canvas shadows className="w-full" style={{ height: '80vh' }}>
                {/* Lighting */}
                <ambientLight intensity={0.5} />
                <directionalLight
                    position={[10, 10, 5]}
                    intensity={1}
                    castShadow
                    shadow-mapSize-width={2048}
                    shadow-mapSize-height={2048}
                />

                {/* Game state manager */}
                <GameManager npcs={npcs} setNpcs={setNpcs} waypoints={waypoints} />

                {/* Camera */}
                <CameraController playerPosition={playerPosition} />

                {/* Environment */}
                <Ground onClick={handleGroundClick} />

                {/* Player */}
                <Player
                    position={playerPosition}
                    setPosition={setPlayerPosition}
                    disabled={npcs.some(npc => npc.isInteracting)}
                />

                {/* NPCs */}
                {npcs.map((npc) => (
                    <NPC
                        key={npc.id}
                        npc={npc}
                        waypoints={waypoints}
                        onInteract={handleNpcInteraction}
                        onSendMessage={handleSendMessage}
                    />
                ))}

                {/* Waypoints */}
                {waypoints.map((waypoint) => (
                    <Waypoint
                        key={waypoint.id}
                        waypoint={waypoint}
                    />
                ))}

                {/* Controls for development/debugging */}
                <OrbitControls enabled={false} />
            </Canvas>

            {/* Game Instructions */}
            <div className="absolute top-4 left-4 bg-black bg-opacity-70 p-3 rounded text-white text-sm">
                <p>Move: WASD or Arrow Keys</p>
                <p>Interact: Click on an NPC</p>
                <p className="mt-2">Goal: Convince all NPCs to move to the yellow target</p>
            </div>

            {/* Win Overlay */}
            {gameWon && (
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
                    <div className="bg-slate-800 p-8 rounded-lg shadow-xl text-center max-w-md">
                        <h2 className="text-4xl font-bold text-yellow-400 mb-4">You Won!</h2>
                        <p className="text-white text-xl mb-6">
                            You successfully herded all the cats in{' '}
                            <span className="font-bold">{Math.floor(gameTime / 60)}m {gameTime % 60}s</span>
                        </p>
                        <button
                            onClick={handleRestart}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg text-lg transition-colors"
                        >
                            Play Again
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
} 