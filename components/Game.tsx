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
  useTexture,
} from '@react-three/drei';
import {
  Canvas,
  ThreeEvent,
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
    type: string;
    radius: number; // How close an NPC can get to this waypoint
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
    readTimeRemaining: number; // Time player has to read response
    responseComplete: boolean; // Whether response is complete and in read time
    convincedThroughDialogue: boolean; // New property to track if convinced through dialogue
}

// Helper functions
const calculateDistance = (pos1: Position, pos2: Position): number => {
    return Math.sqrt(Math.pow(pos2.x - pos1.x, 2) + Math.pow(pos2.z - pos1.z, 2));
};

// Calculate read time based on message length (250ms per word)
const calculateReadTime = (message: string): number => {
    const wordCount = message.split(/\s+/).length;
    return Math.max(2, wordCount * 0.15); // Reduced from 0.25 to 0.15, min from 3 to 2 seconds
};

// Player character component
function Player({
    position,
    setPosition,
    disabled,
    influenceRadius = 8, // Default radius for the circle of influence
    waypoints,
    destination,
    setPlayerDestination
}: {
    position: Position;
    setPosition: (pos: Position) => void;
    disabled: boolean;
    influenceRadius?: number;
    waypoints: Waypoint[]; // Add waypoints prop to find light sources
    destination: Position | null; // New prop for click-to-move destination
    setPlayerDestination: React.Dispatch<React.SetStateAction<Position | null>>;
}) {
    const groupRef = useRef<THREE.Group>(null);
    const [keys, setKeys] = useState({
        forward: false,
        backward: false,
        left: false,
        right: false,
    });
    const [rotation, setRotation] = useState(0);
    const [isWalking, setIsWalking] = useState(false);
    const [walkingAnim, setWalkingAnim] = useState(0);
    const lastPositionRef = useRef<Position>({ ...position });

    // Points for the line from head to light
    const [points, setPoints] = useState<THREE.Vector3[]>([
        new THREE.Vector3(position.x, 1.1, position.z),
        new THREE.Vector3(0, 0, 0) // Will be updated with light position
    ]);

    const speed = 0.1;
    // Define boundary limits (slightly inside the fence)
    const boundaryLimit = 23; // Half of the fence size (48/2) minus a small buffer

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

    // Find nearest light source
    const getNearestLightPosition = (): THREE.Vector3 | null => {
        // Filter waypoints to get only lightpoles
        const lightpoles = waypoints.filter(wp => wp.type === 'lightpole');
        if (lightpoles.length === 0) return null;

        // Find the nearest one
        let nearestLightpole = lightpoles[0];
        let minDistance = calculateDistance(position, nearestLightpole.position);

        lightpoles.forEach(lightpole => {
            const distance = calculateDistance(position, lightpole.position);
            if (distance < minDistance) {
                minDistance = distance;
                nearestLightpole = lightpole;
            }
        });

        // Return the position as Vector3 with light height
        return new THREE.Vector3(
            nearestLightpole.position.x,
            2.7, // Light height
            nearestLightpole.position.z
        );
    };

    // Update line points when position changes
    useEffect(() => {
        const lightPos = getNearestLightPosition();
        if (lightPos) {
            setPoints([
                new THREE.Vector3(position.x, 1.1, position.z), // Head position
                lightPos
            ]);
        }
    }, [position.x, position.z]);

    // Handle movement and update light line
    useFrame((_, delta) => {
        if (!groupRef.current) return;

        let newPos = { ...position };
        let isMoving = false;
        let moveX = 0, moveZ = 0;

        // Check if any keyboard keys are pressed for movement
        const isKeyboardMoving = keys.forward || keys.backward || keys.left || keys.right;

        // Handle keyboard movement
        if (keys.forward) { newPos.z -= speed; moveZ -= 1; isMoving = true; }
        if (keys.backward) { newPos.z += speed; moveZ += 1; isMoving = true; }
        if (keys.left) { newPos.x -= speed; moveX -= 1; isMoving = true; }
        if (keys.right) { newPos.x += speed; moveX += 1; isMoving = true; }

        // If using keyboard movement, clear the destination
        if (isKeyboardMoving && destination) {
            setPlayerDestination(null);
        }

        // Handle click-to-move if there's a destination and not keyboard movement
        if (destination && !isMoving) {
            const distanceToDestination = calculateDistance(position, destination);

            // Only move if we're not already at the destination
            if (distanceToDestination > 0.1) {
                // Calculate direction to destination
                const directionX = destination.x - position.x;
                const directionZ = destination.z - position.z;

                // Normalize direction
                const length = Math.sqrt(directionX * directionX + directionZ * directionZ);
                const normalizedX = directionX / length;
                const normalizedZ = directionZ / length;

                // Calculate movement (clamped to speed)
                const moveAmount = Math.min(speed, distanceToDestination);
                newPos.x += normalizedX * moveAmount;
                newPos.z += normalizedZ * moveAmount;

                // Calculate rotation to face movement direction
                const targetRotation = Math.atan2(normalizedX, normalizedZ);
                setRotation(targetRotation);

                isMoving = true;
            } else {
                // We've reached the destination, clear it
                setPlayerDestination(null);
            }
        }

        // Enforce boundary limits
        newPos.x = Math.max(-boundaryLimit, Math.min(boundaryLimit, newPos.x));
        newPos.z = Math.max(-boundaryLimit, Math.min(boundaryLimit, newPos.z));

        // Update walking animation
        setIsWalking(isMoving);
        if (isMoving) {
            // Increment walking animation counter (for leg/arm movement)
            setWalkingAnim((prev) => (prev + delta * 10) % (Math.PI * 2));

            // Calculate rotation based on movement direction for keyboard movement
            if (moveX !== 0 || moveZ !== 0) {
                const targetRotation = Math.atan2(moveX, moveZ);
                setRotation(targetRotation);
            }
        }

        // Apply the new position
        setPosition(newPos);

        // Update group position (whole character)
        groupRef.current.position.x = newPos.x;
        groupRef.current.position.z = newPos.z;

        // Update the line points in real-time
        const lightPos = getNearestLightPosition();
        if (lightPos) {
            // Direct update during frame without setState to avoid render loop
            points[0].set(newPos.x, 1.1, newPos.z);
            points[1].copy(lightPos);
        }
    });

    // Calculate limb animations
    const leftLegRotation = isWalking ? Math.sin(walkingAnim) * 0.4 : 0;
    const rightLegRotation = isWalking ? -Math.sin(walkingAnim) * 0.4 : 0;
    const leftArmRotation = isWalking ? -Math.sin(walkingAnim) * 0.4 : 0;
    const rightArmRotation = isWalking ? Math.sin(walkingAnim) * 0.4 : 0;
    const bodyBobHeight = isWalking ? Math.abs(Math.sin(walkingAnim)) * 0.05 : 0;

    return (
        <>
            {/* Main character group */}
            <group
                ref={groupRef}
                position={[position.x, 0.5 + bodyBobHeight, position.z]}
                rotation={[0, rotation + Math.PI, 0]}
            >
                {/* Head */}
                <mesh position={[0, 0.6, 0]} castShadow>
                    <boxGeometry args={[0.5, 0.5, 0.5]} />
                    <meshStandardMaterial color="#f9c49a" />

                    {/* Eyes */}
                    <mesh position={[0.13, 0.05, -0.26]} castShadow>
                        <boxGeometry args={[0.1, 0.1, 0.02]} />
                        <meshStandardMaterial color="#3a3a3c" />
                    </mesh>
                    <mesh position={[-0.13, 0.05, -0.26]} castShadow>
                        <boxGeometry args={[0.1, 0.1, 0.02]} />
                        <meshStandardMaterial color="#3a3a3c" />
                    </mesh>

                    {/* Mouth */}
                    <mesh position={[0, -0.1, -0.26]} castShadow>
                        <boxGeometry args={[0.2, 0.05, 0.02]} />
                        <meshStandardMaterial color="#5c3c2e" />
                    </mesh>
                </mesh>

                {/* Body */}
                <mesh position={[0, 0, 0]} castShadow>
                    <boxGeometry args={[0.5, 0.7, 0.3]} />
                    <meshStandardMaterial color="#41a33e" />
                </mesh>

                {/* Arms */}
                <group position={[0.3, 0.2, 0]} rotation={[leftArmRotation, 0, 0]}>
                    <mesh position={[0, -0.2, 0]} castShadow>
                        <boxGeometry args={[0.15, 0.6, 0.15]} />
                        <meshStandardMaterial color="#41a33e" />
                    </mesh>
                </group>
                <group position={[-0.3, 0.2, 0]} rotation={[rightArmRotation, 0, 0]}>
                    <mesh position={[0, -0.2, 0]} castShadow>
                        <boxGeometry args={[0.15, 0.6, 0.15]} />
                        <meshStandardMaterial color="#41a33e" />
                    </mesh>
                </group>

                {/* Legs */}
                <group position={[0.15, -0.4, 0]} rotation={[leftLegRotation, 0, 0]}>
                    <mesh position={[0, -0.3, 0]} castShadow>
                        <boxGeometry args={[0.15, 0.6, 0.15]} />
                        <meshStandardMaterial color="#1560bd" />
                    </mesh>
                </group>
                <group position={[-0.15, -0.4, 0]} rotation={[rightLegRotation, 0, 0]}>
                    <mesh position={[0, -0.3, 0]} castShadow>
                        <boxGeometry args={[0.15, 0.6, 0.15]} />
                        <meshStandardMaterial color="#1560bd" />
                    </mesh>
                </group>
            </group>

            {/* Line to light source */}
            <line>
                <bufferGeometry>
                    <float32BufferAttribute attach="attributes-position" args={[new Float32Array(points.flatMap(p => [p.x, p.y, p.z])), 3]} />
                </bufferGeometry>
                <lineBasicMaterial color="red" />
            </line>

            {/* Circle of influence */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[position.x, 0.05, position.z]}>
                <circleGeometry args={[influenceRadius, 32]} />
                <meshStandardMaterial color="#ffff00" transparent opacity={0.15} />
            </mesh>
        </>
    );
}

// NPC component
function NPC({
    npc,
    waypoints,
    onInteract,
    onSendMessage,
    playerPosition,
    influenceRadius = 8
}: {
    npc: NPC;
    waypoints: Waypoint[];
    onInteract: (id: number) => void;
    onSendMessage: (id: number, message: string) => void;
    playerPosition: Position;
    influenceRadius?: number;
}) {
    const groupRef = useRef<THREE.Group>(null);
    const bodyRef = useRef<THREE.Mesh>(null);
    const [message, setMessage] = useState('');
    const conversationContainerRef = useRef<HTMLDivElement>(null);
    const [rotation, setRotation] = useState(0);
    const lastPositionRef = useRef<Position>({ ...npc.position });

    // Scroll to bottom of conversation when new messages appear
    useEffect(() => {
        if (conversationContainerRef.current) {
            // Force scroll to bottom of the conversation container
            const container = conversationContainerRef.current;
            setTimeout(() => {
                container.scrollTop = container.scrollHeight;
            }, 50); // Small delay to ensure content is rendered
        }
    }, [npc.conversationHistory, npc.aiResponse?.result?.message, npc.isTyping]);

    // Handle NPC movement
    useFrame((_, delta) => {
        if (!groupRef.current || npc.isInteracting) return;

        // If we need to choose a waypoint
        if (npc.targetWaypoint === null) {
            return; // This will be handled in the parent component
        }

        // If at waypoint, check dwell time
        const targetWaypoint = waypoints.find(wp => wp.id === npc.targetWaypoint);
        if (!targetWaypoint) return;

        const distance = calculateDistance(npc.position, targetWaypoint.position);

        // If very close to waypoint (respecting the waypoint's radius)
        if (distance <= targetWaypoint.radius + 0.5) {
            // If just arrived, update position to be exactly at the edge of radius
            if (Math.abs(distance - targetWaypoint.radius) > 0.1) {
                // Calculate position at the edge of the radius
                const directionX = targetWaypoint.position.x - npc.position.x;
                const directionZ = targetWaypoint.position.z - npc.position.z;
                const dirLength = Math.sqrt(directionX * directionX + directionZ * directionZ);

                // Normalize and position at radius
                const normalizedX = directionX / dirLength;
                const normalizedZ = directionZ / dirLength;

                // Position at radius distance from waypoint
                npc.position.x = targetWaypoint.position.x - (normalizedX * targetWaypoint.radius);
                npc.position.z = targetWaypoint.position.z - (normalizedZ * targetWaypoint.radius);

                groupRef.current.position.x = npc.position.x;
                groupRef.current.position.z = npc.position.z;
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

        // Previous position
        const prevPos = { ...npc.position };

        // Update position
        npc.position.x += normalizedX * npc.speed;
        npc.position.z += normalizedZ * npc.speed;

        // If moved enough to calculate direction
        if (calculateDistance(prevPos, npc.position) > 0.01) {
            // Calculate rotation based on movement direction
            const targetRotation = Math.atan2(normalizedX, normalizedZ);
            // Smooth rotation 
            setRotation(targetRotation);
            lastPositionRef.current = { ...npc.position };
        }

        // Update group position
        groupRef.current.position.x = npc.position.x;
        groupRef.current.position.z = npc.position.z;
    });

    // Add state for showing the out-of-range indicator
    const [showOutOfRangeIndicator, setShowOutOfRangeIndicator] = useState(false);

    // Function to check if NPC is within player's influence radius
    const isWithinInfluence = (): boolean => {
        return calculateDistance(npc.position, playerPosition) <= influenceRadius;
    };

    // Handle clicks on the NPC
    const handleClick = (e: any) => {
        e.stopPropagation();

        // Check if NPC is within player's influence radius
        if (isWithinInfluence()) {
            onInteract(npc.id);
        } else {
            // Show out-of-range indicator
            setShowOutOfRangeIndicator(true);
            // Hide after delay
            setTimeout(() => setShowOutOfRangeIndicator(false), 2000);
        }
    };

    // Handle sending a message
    const handleSendMessage = (e: React.FormEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (message.trim()) {
            onSendMessage(npc.id, message);
            setMessage('');
        }
    };

    // Handle text input click
    const handleInputClick = (e: React.MouseEvent) => {
        e.stopPropagation();
    };

    // Handle dialogue click to prevent closing
    const handleDialogueClick = (e: React.MouseEvent) => {
        e.stopPropagation();
    };

    // Calculate dialogue top position (fixed distance above NPC's head)
    const dialogueYPosition = 2.5; // Increased height above NPC

    // Display read time indicator if response is complete
    const readTimeProgress = npc.readTimeRemaining > 0 && npc.responseComplete
        ? Math.min(100, (1 - npc.readTimeRemaining / calculateReadTime(npc.aiResponse?.result?.message || '')) * 100)
        : 0;

    // Get base cat color
    const catColor = npc.color === "red" ? "#ff6b6b" : "#6b9fff";
    const catEyeColor = npc.color === "red" ? "#ffcc00" : "#00ccff";

    // Handle emissive effects for state
    const isEmissive = npc.isInteracting || npc.isConvinced;
    const emissiveColor = npc.isInteracting ? "white" : "yellow";
    const emissiveIntensity = npc.isInteracting ? 0.3 : (npc.isConvinced ? 0.2 : 0);

    // Determine if cat is above or below player (in the z-axis)
    const isCatAbovePlayer = npc.position.z < playerPosition.z;

    // Determine if input should be disabled (when typing or convinced, but NOT during read time)
    const isInputDisabled = npc.isTyping || npc.convincedThroughDialogue;

    return (
        <group>
            {/* Cat model */}
            <group
                ref={groupRef}
                position={[npc.position.x, 0.5, npc.position.z]}
                rotation={[0, rotation + Math.PI, 0]}
                onClick={handleClick}
            >
                {/* Body */}
                <mesh position={[0, 0, 0]} castShadow ref={bodyRef}>
                    <boxGeometry args={[0.9, 0.6, 1.2]} />
                    <meshStandardMaterial
                        color={catColor}
                        emissive={emissiveColor}
                        emissiveIntensity={emissiveIntensity}
                    />
                </mesh>

                {/* Head */}
                <mesh position={[0, 0.3, -0.6]} castShadow>
                    <boxGeometry args={[0.7, 0.6, 0.6]} />
                    <meshStandardMaterial
                        color={catColor}
                        emissive={emissiveColor}
                        emissiveIntensity={emissiveIntensity}
                    />
                </mesh>

                {/* Ears */}
                <mesh position={[-0.25, 0.7, -0.6]} rotation={[0, 0, Math.PI / 4]} castShadow>
                    <boxGeometry args={[0.2, 0.3, 0.1]} />
                    <meshStandardMaterial color={catColor} />
                </mesh>
                <mesh position={[0.25, 0.7, -0.6]} rotation={[0, 0, -Math.PI / 4]} castShadow>
                    <boxGeometry args={[0.2, 0.3, 0.1]} />
                    <meshStandardMaterial color={catColor} />
                </mesh>

                {/* Eyes */}
                <mesh position={[-0.2, 0.3, -0.91]} castShadow>
                    <sphereGeometry args={[0.12, 16, 16]} />
                    <meshStandardMaterial color={catEyeColor} emissive={catEyeColor} emissiveIntensity={0.5} />
                </mesh>
                <mesh position={[0.2, 0.3, -0.91]} castShadow>
                    <sphereGeometry args={[0.12, 16, 16]} />
                    <meshStandardMaterial color={catEyeColor} emissive={catEyeColor} emissiveIntensity={0.5} />
                </mesh>

                {/* Nose */}
                <mesh position={[0, 0.1, -0.91]} castShadow>
                    <sphereGeometry args={[0.07, 16, 16]} />
                    <meshStandardMaterial color="#ff9999" />
                </mesh>

                {/* Tail */}
                <mesh position={[0, 0.2, 0.7]} rotation={[Math.PI / 4, 0, 0]} castShadow>
                    <cylinderGeometry args={[0.08, 0.12, 0.8, 8]} />
                    <meshStandardMaterial color={catColor} />
                </mesh>
            </group>

            {/* Out of range indicator */}
            {showOutOfRangeIndicator && (
                <Html position={[npc.position.x, 1.8, npc.position.z]} center>
                    <div className="bg-black bg-opacity-80 text-white p-2 rounded text-sm animate-bounce">
                        <p>Too far away!<br />Move closer to interact</p>
                    </div>
                </Html>
            )}

            {/* Convinced timer display */}
            {npc.isConvinced && (
                <Html position={[npc.position.x, 1.2, npc.position.z]} center>
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

            {/* Interaction UI */}
            {npc.isInteracting && (
                <Html
                    position={[npc.position.x, dialogueYPosition, npc.position.z]}
                    center
                    style={{
                        transformOrigin: isCatAbovePlayer ? 'top center' : 'bottom center',
                        pointerEvents: 'auto'
                    }}
                >
                    <div
                        className="bg-black bg-opacity-80 text-white p-3 rounded w-96 flex flex-col"
                        style={{
                            position: 'absolute',
                            // If cat is above player, place below; otherwise, place above
                            [isCatAbovePlayer ? 'top' : 'bottom']: '80px',
                            transform: 'translateX(-50%)', // Center horizontally
                        }}
                        onClick={handleDialogueClick}
                    >
                        <p className="text-center font-bold mb-2">
                            Talking to Cat {npc.id}
                            {npc.convincedThroughDialogue && (
                                <span className="ml-2 text-green-400">(Convinced!)</span>
                            )}
                        </p>

                        {/* Display conversation history */}
                        <div
                            ref={conversationContainerRef}
                            className="mb-3 overflow-y-auto flex-grow"
                            style={{ maxHeight: '200px', scrollBehavior: 'smooth' }}
                        >
                            {npc.conversationHistory.map((msg, idx) => (
                                <div key={idx} className={`mb-2 ${msg.role === 'user' ? 'text-green-400' : 'text-blue-400'}`}>
                                    <span className="font-bold">{msg.role === 'user' ? 'You' : 'Cat'}:</span> {msg.content}
                                </div>
                            ))}

                            {/* Show AI response if available */}
                            {npc.aiResponse?.result?.message && (
                                <div className="mb-2 text-blue-400">
                                    <span className="font-bold">Cat:</span> {npc.aiResponse.result.message}
                                </div>
                            )}

                            {/* Show typing indicator */}
                            {npc.isTyping && (
                                <div className="mb-2 text-gray-400">
                                    <span className="font-bold">Cat:</span> <span className="animate-pulse">...</span>
                                </div>
                            )}
                        </div>

                        {/* Read time indicator */}
                        {readTimeProgress > 0 && (
                            <div className="mt-2 bg-gray-700 h-1 w-full rounded">
                                <div
                                    className="bg-blue-500 h-1 rounded transition-all duration-300 ease-linear"
                                    style={{ width: `${readTimeProgress}%` }}
                                ></div>
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

                        {/* Show message when convinced */}
                        {npc.convincedThroughDialogue && (
                            <div className="my-2 text-green-400 bg-black bg-opacity-50 p-2 rounded text-center">
                                <p>This cat is now heading to the target!</p>
                                <p className="text-xs mt-1">Dialogue will close automatically after timer</p>
                            </div>
                        )}

                        {/* Input form - disabled when convinced */}
                        <form onSubmit={handleSendMessage} className="flex flex-col gap-2 mt-2">
                            <input
                                type="text"
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder={npc.convincedThroughDialogue ? "Cat is convinced!" : "Type your message..."}
                                className={`p-2 rounded bg-gray-800 text-white w-full ${npc.convincedThroughDialogue ? 'opacity-50' : ''}`}
                                autoFocus={!npc.convincedThroughDialogue}
                                disabled={isInputDisabled}
                                onClick={handleInputClick}
                            />
                            <div className="flex justify-between">
                                <button
                                    type="submit"
                                    className={`bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded ${isInputDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    disabled={isInputDisabled}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    Send
                                </button>
                                <button
                                    type="button"
                                    className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-1 rounded"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (!npc.isTyping && (!npc.responseComplete || npc.readTimeRemaining <= 0)) {
                                            onInteract(npc.id);
                                        }
                                    }}
                                    disabled={npc.isTyping || (npc.responseComplete && npc.readTimeRemaining > 0)}
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
            {/* Render different models based on waypoint type */}
            {waypoint.type === 'lightpole' && (
                <group>
                    {/* Pole */}
                    <mesh position={[0, 1.25, 0]} castShadow>
                        <cylinderGeometry args={[0.1, 0.2, 2.5, 8]} />
                        <meshStandardMaterial color="#555555" />
                    </mesh>
                    {/* Light */}
                    <mesh position={[0, 2.7, 0]} castShadow>
                        <sphereGeometry args={[0.3, 16, 16]} />
                        <meshStandardMaterial
                            color="#ffffaa"
                            emissive="#ffffaa"
                            emissiveIntensity={0.5}
                        />
                    </mesh>
                    {/* Add actual light source */}
                    <pointLight
                        position={[0, 2.7, 0]}
                        color="#ffffaa"
                        intensity={10.0}
                        distance={40}
                        castShadow
                        shadow-mapSize-width={512}
                        shadow-mapSize-height={512}
                    />
                </group>
            )}

            {waypoint.type === 'bush' && (
                <group>
                    {/* Bush leaves */}
                    <mesh position={[0, 0.6, 0]} castShadow>
                        <sphereGeometry args={[1, 16, 16]} />
                        <meshStandardMaterial color="#1a8f3a" />
                    </mesh>
                    {/* Smaller inner leaves */}
                    <mesh position={[0.3, 0.8, 0.3]} castShadow>
                        <sphereGeometry args={[0.6, 16, 16]} />
                        <meshStandardMaterial color="#26a64a" />
                    </mesh>
                    <mesh position={[-0.4, 0.7, -0.2]} castShadow>
                        <sphereGeometry args={[0.7, 16, 16]} />
                        <meshStandardMaterial color="#1a8f3a" />
                    </mesh>
                </group>
            )}

            {waypoint.type === 'bench' && (
                <group>
                    {/* Seat */}
                    <mesh position={[0, 0.5, 0]} castShadow>
                        <boxGeometry args={[2, 0.1, 0.7]} />
                        <meshStandardMaterial color="#8B4513" />
                    </mesh>
                    {/* Backrest */}
                    <mesh position={[0, 1, -0.3]} castShadow rotation={[0.3, 0, 0]}>
                        <boxGeometry args={[2, 0.7, 0.1]} />
                        <meshStandardMaterial color="#8B4513" />
                    </mesh>
                    {/* Legs */}
                    <mesh position={[-0.8, 0.25, 0]} castShadow>
                        <boxGeometry args={[0.1, 0.5, 0.6]} />
                        <meshStandardMaterial color="#5c2c0d" />
                    </mesh>
                    <mesh position={[0.8, 0.25, 0]} castShadow>
                        <boxGeometry args={[0.1, 0.5, 0.6]} />
                        <meshStandardMaterial color="#5c2c0d" />
                    </mesh>
                </group>
            )}

            {waypoint.type === 'fountain' && (
                <group>
                    {/* Base */}
                    <mesh position={[0, 0.2, 0]} receiveShadow>
                        <cylinderGeometry args={[1.5, 1.7, 0.4, 32]} />
                        <meshStandardMaterial color="#aaaaaa" />
                    </mesh>
                    {/* Water basin */}
                    <mesh position={[0, 0.5, 0]} receiveShadow>
                        <cylinderGeometry args={[1.2, 1.2, 0.4, 32]} />
                        <meshStandardMaterial color="#aaaaaa" />
                    </mesh>
                    {/* Center pillar */}
                    <mesh position={[0, 0.8, 0]} castShadow>
                        <cylinderGeometry args={[0.2, 0.3, 0.6, 16]} />
                        <meshStandardMaterial color="#888888" />
                    </mesh>
                    {/* Water (animated in a full implementation) */}
                    <mesh position={[0, 0.6, 0]} receiveShadow>
                        <cylinderGeometry args={[1, 1, 0.1, 32]} />
                        <meshStandardMaterial
                            color="#5c94e0"
                            transparent
                            opacity={0.7}
                        />
                    </mesh>
                </group>
            )}

            {waypoint.type === 'tree' && (
                <group>
                    {/* Trunk */}
                    <mesh position={[0, 1, 0]} castShadow>
                        <cylinderGeometry args={[0.3, 0.5, 2, 8]} />
                        <meshStandardMaterial color="#6d4c33" />
                    </mesh>
                    {/* Leaves */}
                    <mesh position={[0, 2.5, 0]} castShadow>
                        <sphereGeometry args={[1.5, 16, 16]} />
                        <meshStandardMaterial color="#1d7e3a" />
                    </mesh>
                    <mesh position={[0.5, 3, 0.5]} castShadow>
                        <sphereGeometry args={[0.8, 16, 16]} />
                        <meshStandardMaterial color="#1a8f3a" />
                    </mesh>
                </group>
            )}

            {waypoint.type === 'rock' && (
                <group>
                    <mesh position={[0, 0.6, 0]} rotation={[0.2, 0.5, 0.3]} castShadow>
                        <boxGeometry args={[1.2, 1.2, 1.2]} />
                        <meshStandardMaterial color="#777777" />
                    </mesh>
                    <mesh position={[0.3, 0.3, 0.4]} rotation={[0.4, 0.2, 0.5]} castShadow>
                        <boxGeometry args={[0.7, 0.6, 0.8]} />
                        <meshStandardMaterial color="#666666" />
                    </mesh>
                </group>
            )}

            {waypoint.type === 'signpost' && (
                <group>
                    {/* Post */}
                    <mesh position={[0, 1, 0]} castShadow>
                        <cylinderGeometry args={[0.1, 0.1, 2, 8]} />
                        <meshStandardMaterial color="#8B4513" />
                    </mesh>
                    {/* Sign */}
                    <mesh position={[0.5, 1.7, 0]} castShadow>
                        <boxGeometry args={[1, 0.6, 0.05]} />
                        <meshStandardMaterial color="#eedd82" />
                    </mesh>
                </group>
            )}

            {/* Default waypoint marker (fallback) */}
            {!['lightpole', 'bush', 'bench', 'fountain', 'tree', 'rock', 'signpost'].includes(waypoint.type) && (
                <mesh position={[0, 0.25, 0]}>
                    <cylinderGeometry args={[1, 1, 0.5, 32]} />
                    <meshStandardMaterial color={waypoint.isTarget ? "#ffff00" : "#aaaaaa"} />
                </mesh>
            )}

            {/* Target indicator - highlight for the target waypoint */}
            {waypoint.isTarget && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
                    <ringGeometry args={[1.8, 2, 32]} />
                    <meshStandardMaterial
                        color="#ffff00"
                        emissive="#ffff00"
                        emissiveIntensity={0.3}
                        transparent
                        opacity={0.6}
                    />
                </mesh>
            )}

            {/* Waypoint label */}
            <Html position={[0, waypoint.type === 'tree' ? 4.2 : 3, 0]} center>
                <div className="text-white bg-black bg-opacity-50 px-2 py-1 rounded text-sm font-bold">
                    {waypoint.name}{waypoint.isTarget ? " (Target)" : ""}
                </div>
            </Html>
        </group>
    );
}

// Ground component
function Ground({ onClick }: { onClick?: (position: Position | null) => void }) {
    // Load grass texture
    const grassTexture = useTexture('/textures/grass.jpg');

    // Configure texture to be tileable
    grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
    grassTexture.repeat.set(20, 20); // Increased tiling for more natural look
    grassTexture.colorSpace = THREE.SRGBColorSpace;

    const handleClick = (event: ThreeEvent<MouseEvent>) => {
        if (onClick && event.point) {
            // Pass the clicked position to the parent component
            onClick({
                x: event.point.x,
                z: event.point.z
            });
        }
    };

    return (
        <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0, 0]}
            receiveShadow
            onClick={handleClick}
        >
            <planeGeometry args={[50, 50]} />
            <meshStandardMaterial
                map={grassTexture}
                roughness={0.9}
                metalness={0.1}
                color="#9db552" // Slight tint to adjust grass color
            />
        </mesh>
    );
}

// Fence component
function Fence() {
    // Define the boundaries
    const size = 48; // Slightly smaller than the ground (which is 50x50)
    const halfSize = size / 2;
    const postHeight = 2;
    const postSpacing = 4;
    const numPosts = Math.floor(size / postSpacing) + 1;

    // Create posts and rails along the perimeter
    const fencePosts = [];
    const fenceRails = [];

    // Helper function to create a post
    const createPost = (x: number, z: number, index: number) => {
        return (
            <mesh key={`post-${index}`} position={[x, postHeight / 2, z]} castShadow>
                <boxGeometry args={[0.3, postHeight, 0.3]} />
                <meshStandardMaterial color="#8B4513" />
            </mesh>
        );
    };

    // Helper function to create a rail
    const createRail = (x1: number, z1: number, x2: number, z2: number, index: number) => {
        // Calculate midpoint and distance
        const midX = (x1 + x2) / 2;
        const midZ = (z1 + z2) / 2;
        const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(z2 - z1, 2));

        // Calculate rotation
        const angle = Math.atan2(z2 - z1, x2 - x1);

        return (
            <mesh key={`rail-${index}`} position={[midX, postHeight - 0.3, midZ]} rotation={[0, angle, 0]} castShadow>
                <boxGeometry args={[length, 0.2, 0.1]} />
                <meshStandardMaterial color="#8B4513" />
            </mesh>
        );
    };

    // Generate posts and rails along each side
    let postIndex = 0;
    let railIndex = 0;

    // Create north and south fences
    for (let i = 0; i < numPosts; i++) {
        const x = -halfSize + i * postSpacing;

        // North fence
        fencePosts.push(createPost(x, -halfSize, postIndex++));
        if (i < numPosts - 1) {
            fenceRails.push(createRail(x, -halfSize, x + postSpacing, -halfSize, railIndex++));
        }

        // South fence
        fencePosts.push(createPost(x, halfSize, postIndex++));
        if (i < numPosts - 1) {
            fenceRails.push(createRail(x, halfSize, x + postSpacing, halfSize, railIndex++));
        }
    }

    // Create east and west fences
    for (let i = 1; i < numPosts - 1; i++) { // Skip corners to avoid duplicates
        const z = -halfSize + i * postSpacing;

        // East fence
        fencePosts.push(createPost(-halfSize, z, postIndex++));
        fenceRails.push(createRail(-halfSize, z, -halfSize, z + postSpacing, railIndex++));

        // West fence
        fencePosts.push(createPost(halfSize, z, postIndex++));
        fenceRails.push(createRail(halfSize, z, halfSize, z + postSpacing, railIndex++));
    }

    return (
        <group>
            {fencePosts}
            {fenceRails}
        </group>
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
                // Find the target waypoint
                const targetWaypoint = waypoints.find(w => w.isTarget);
                if (!targetWaypoint) return npc;

                // Check if NPC is at the target waypoint
                const distanceToTarget = calculateDistance(npc.position, targetWaypoint.position);
                const atTargetPosition = distanceToTarget <= targetWaypoint.radius + 1.0;

                // Handle when an NPC leaves the target area but was previously convinced
                if (npc.isConvinced && !atTargetPosition) {
                    // If convinced cat leaves the target area, it's no longer convinced
                    return {
                        ...npc,
                        isConvinced: false,
                        convincedTimer: 0,
                        snarkyComment: null,
                        convincedThroughDialogue: false // Also reset this flag
                    };
                }

                // Update read time countdown if response is complete
                if (npc.isInteracting && npc.responseComplete && npc.readTimeRemaining > 0) {
                    const newReadTime = Math.max(0, npc.readTimeRemaining - delta);

                    // Auto-close dialogue when read time completes
                    if (newReadTime <= 0 && !npc.isTyping) {
                        return {
                            ...npc,
                            readTimeRemaining: 0,
                            isInteracting: false, // Auto-close the dialogue
                            responseComplete: false
                        };
                    }

                    return {
                        ...npc,
                        readTimeRemaining: newReadTime
                    };
                }

                // Skip updates if interacting and not in read time
                if (npc.isInteracting && !npc.responseComplete) return npc;

                // Handle convinced state (only applies when at target)
                if (npc.isConvinced && atTargetPosition) {
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
                            convincedThroughDialogue: false, // Reset this flag too
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
                    const currentTargetWaypoint = waypoints.find(w => w.id === npc.targetWaypoint);
                    if (currentTargetWaypoint) {
                        const distance = calculateDistance(npc.position, currentTargetWaypoint.position);

                        // Check if NPC is at the waypoint's radius
                        if (distance <= currentTargetWaypoint.radius + 0.5) {
                            // Check if NPC has reached the target waypoint AND was previously convinced through dialogue
                            if (currentTargetWaypoint.isTarget && npc.convincedThroughDialogue) {
                                console.log(`NPC ${npc.id} reached target and is convinced through dialogue`);
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
    const [playerDestination, setPlayerDestination] = useState<Position | null>(null);

    // Track game state
    const [gameStartTime, setGameStartTime] = useState<number>(Date.now());
    const [gameWon, setGameWon] = useState<boolean>(false);
    const [gameTime, setGameTime] = useState<number>(0);

    // Game state
    const [waypoints, setWaypoints] = useState<Waypoint[]>([
        { id: 1, name: "Light Pole", position: { x: 10, z: 10 }, isTarget: true, type: "lightpole", radius: 1.5 },
        { id: 2, name: "Bush", position: { x: -10, z: 10 }, isTarget: false, type: "bush", radius: 1.5 },
        { id: 3, name: "Bench", position: { x: 10, z: -10 }, isTarget: false, type: "bench", radius: 2.0 },
        { id: 4, name: "Fountain", position: { x: -10, z: -10 }, isTarget: false, type: "fountain", radius: 2.5 },
        { id: 5, name: "Tree", position: { x: 15, z: 0 }, isTarget: false, type: "tree", radius: 2.0 },
        { id: 6, name: "Rock", position: { x: -15, z: 0 }, isTarget: false, type: "rock", radius: 1.5 },
        { id: 7, name: "Signpost", position: { x: 0, z: 15 }, isTarget: false, type: "signpost", radius: 1.0 },
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
            snarkyComment: null,
            readTimeRemaining: 0,
            responseComplete: false,
            convincedThroughDialogue: false
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
            snarkyComment: null,
            readTimeRemaining: 0,
            responseComplete: false,
            convincedThroughDialogue: false
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

    // Check for win condition
    useEffect(() => {
        // If already won, don't check again
        if (gameWon) return;

        // Check if all NPCs are at the target waypoint
        const targetWaypoint = waypoints.find(w => w.isTarget);
        if (!targetWaypoint) return;

        const allNpcsAtTarget = npcs.every(npc => {
            // Check if NPC is convinced AND actually at the target waypoint
            // Account for the waypoint radius in our distance check
            const distance = calculateDistance(npc.position, targetWaypoint.position);
            const atTargetPosition = distance <= targetWaypoint.radius + 1.0;

            // Debug logging
            console.log(`NPC ${npc.id}: convinced=${npc.isConvinced}, distance=${distance.toFixed(2)}, radius=${targetWaypoint.radius}, at target=${atTargetPosition}`);

            return npc.isConvinced && atTargetPosition;
        });

        if (allNpcsAtTarget && npcs.length > 0) {
            // Calculate time taken
            const timeElapsed = Math.floor((Date.now() - gameStartTime) / 1000);
            setGameTime(timeElapsed);
            setGameWon(true);
        }
    }, [npcs, waypoints, gameWon, gameStartTime]);

    // Handle NPC interaction
    const handleNpcInteraction = (npcId: number) => {
        setNpcs(currentNpcs =>
            currentNpcs.map(npc => {
                // If this is the clicked NPC
                if (npc.id === npcId) {
                    // If already interacting, toggle off only if allowed (not typing, not in read time)
                    if (npc.isInteracting) {
                        if (npc.isTyping || (npc.responseComplete && npc.readTimeRemaining > 0)) {
                            return npc; // Don't allow closing yet
                        }
                        return { ...npc, isInteracting: false, responseComplete: false };
                    }
                    // Otherwise, toggle on and disable other NPCs
                    return { ...npc, isInteracting: true };
                }
                // Always turn off other NPCs
                return { ...npc, isInteracting: false };
            })
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
                        isTyping: true,
                        responseComplete: false,
                        readTimeRemaining: 0
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
                            ? {
                                ...n,
                                aiResponse: partialObject,
                                isTyping: !partialObject?.result?.message,
                                // Set read time when result is available
                                readTimeRemaining: partialObject?.result?.message
                                    ? calculateReadTime(partialObject.result.message)
                                    : 0,
                                responseComplete: !!partialObject?.result?.message
                            }
                            : n
                    )
                );
            }

            // When streaming is complete, apply any target changes
            setNpcs(currentNpcs =>
                currentNpcs.map(n => {
                    if (n.id !== npcId) return n;

                    const newTarget = n.aiResponse?.result?.newTarget;
                    const targetWaypointId = waypoints.find(w => w.isTarget)?.id;

                    // Only mark as convinced if the AI EXPLICITLY directed the cat to the target waypoint
                    const isNowConvinced = typeof newTarget === 'number' && newTarget === targetWaypointId;

                    // Log for debugging
                    if (isNowConvinced) {
                        console.log(`NPC ${n.id} convinced to go to target waypoint ${targetWaypointId}`);
                    }

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
                        isTyping: false,
                        responseComplete: true,
                        readTimeRemaining: calculateReadTime(n.aiResponse?.result?.message || ''),
                        // Set the convinced flag ONLY if the AI directed to target waypoint
                        convincedThroughDialogue: isNowConvinced,
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
                                    role: 'assistant' as const,
                                    content: "Sorry, I'm having trouble understanding. Can you try again?"
                                }
                            ],
                            isTyping: false,
                            responseComplete: true,
                            readTimeRemaining: 3 // 3 seconds to read error message
                        }
                        : n
                )
            );
        }
    };

    // Clear all interactions when clicking the ground and set player destination
    const handleGroundClick = (clickPosition: Position | null) => {
        // Set the player destination
        setPlayerDestination(clickPosition);

        // Also handle closing NPC interactions
        setNpcs(currentNpcs =>
            currentNpcs.map(npc => {
                // Only close if not typing and not in read time
                if (npc.isInteracting && (npc.isTyping || (npc.responseComplete && npc.readTimeRemaining > 0))) {
                    return npc; // Don't allow closing yet
                }
                return { ...npc, isInteracting: false, responseComplete: false };
            })
        );
    };

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
            isTyping: false,
            readTimeRemaining: 0,
            responseComplete: false,
            convincedThroughDialogue: false
        })));

        // Reset player position
        setPlayerPosition({ x: 0, z: 0 });
    };

    // Circle of influence radius
    const influenceRadius = 8;

    return (
        <div className="w-full h-full relative">
            <Canvas
                shadows
                className="w-full"
                style={{ height: '80vh', width: '100%' }}
            >
                {/* Lighting */}
                <ambientLight intensity={1.5} />
                {/* <directionalLight
                    position={[100, 100, 100]}
                    intensity={1}
                    castShadow
                    shadow-mapSize-width={2048}
                    shadow-mapSize-height={2048}
                /> */}

                {/* Game state manager */}
                <GameManager npcs={npcs} setNpcs={setNpcs} waypoints={waypoints} />

                {/* Camera */}
                <CameraController playerPosition={playerPosition} />

                {/* Environment */}
                <Ground onClick={handleGroundClick} />

                {/* Fence */}
                <Fence />

                {/* Player */}
                <Player
                    position={playerPosition}
                    setPosition={setPlayerPosition}
                    disabled={npcs.some(npc => npc.isInteracting)}
                    influenceRadius={influenceRadius}
                    waypoints={waypoints}
                    destination={playerDestination}
                    setPlayerDestination={setPlayerDestination}
                />

                {/* NPCs */}
                {npcs.map((npc) => (
                    <NPC
                        key={npc.id}
                        npc={npc}
                        waypoints={waypoints}
                        onInteract={handleNpcInteraction}
                        onSendMessage={handleSendMessage}
                        playerPosition={playerPosition}
                        influenceRadius={influenceRadius}
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
            <div className="absolute top-4 right-4 bg-black bg-opacity-70 p-3 rounded text-white text-sm">
                <p>Move: WASD or Arrow Keys</p>
                <p>Interact: Click on a Cat (within your influence circle)</p>
                <p className="mt-2">Goal: Convince all Cats to move to the yellow target</p>
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