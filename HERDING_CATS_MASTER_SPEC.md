# HERDING CATS - MASTER SPECIFICATION

## Game Concept
"Herding Cats" is a top-down 3D game built with Three.js where players must persuade autonomous NPCs to move to a specific waypoint through conversation. The NPCs actively avoid the target waypoint until convinced otherwise, creating the core challenge.

## Core Gameplay

### Objective
- Convince all NPCs to move to a designated target waypoint
- NPCs naturally avoid the target waypoint in their autonomous movement
- Success requires strategic conversation and persuasion

### Game Environment
- 3D top-down perspective rendered with Three.js
- Open playing field with visible boundaries
- 5-7 distinct waypoints representing different objects:
  - Light pole
  - Bush
  - Bench
  - Fountain
  - Statue
  - Playground
  - Food stand
- Each waypoint visually represented by simple 3D primitives
- One waypoint randomly designated as the target each round

## Characters

### Player Character
- Represented by a green cube
- Movement controlled via WASD/arrow keys
- Can initiate conversation with NPCs by clicking on them
- Must strategically persuade NPCs to change their movement patterns

### NPCs (2-3 initially)
- Represented by colored cubes (red, blue)
- Move autonomously between waypoints
- Deliberately avoid the target waypoint until convinced
- Each NPC has a distinct personality affecting persuadability
- NPCs will face the player during conversation (for up to 10 seconds)
- Can be persuaded to change their waypoint destination

## Technical Systems

### Movement System
- Grid-based or free-form movement for all characters
- Collision detection to prevent overlap
- Pathfinding for NPCs to navigate between waypoints
- Visual indicators for movement direction

### Interaction System
- Click on NPC to initiate conversation
- 10-second timer for conversation duration
- Text input field for player messages
- Display for NPC responses

### Waypoint System
- Waypoints have unique identifiers and visual representations
- NPCs randomly select waypoints (excluding target) for movement
- Target waypoint visually distinguished from others
- Distance calculation for movement planning

### AI Integration
- LLM integration via Vercel AI SDK
- Each NPC receives:
  - Personality profile
  - Current game state (positions, waypoints)
  - Conversation history with player
  - Knowledge of target waypoint (to avoid)
  - Available waypoints
- LLM determines:
  - NPC's verbal response
  - Decision on whether to be persuaded
  - Next waypoint destination (potentially the target if persuaded)

### Memory System
- Tracks conversations between player and each NPC
- Records NPC movement history
- Maintains persuasion status for each NPC
- Provides context for LLM decision-making

## User Interface

### Main Game View
- 3D rendering of game environment
- Camera following player character
- Visual indicators for NPC states (idle, moving, conversing)
- Highlighting for interactive elements

### Dialogue Interface
- Text input field for player
- Text display for NPC responses
- Timer visualization for conversation duration
- Indicator for active conversation

### Game Status
- Current objective display
- Number of NPCs persuaded/remaining
- Time elapsed (if implementing time challenge)
- Round indicator (if implementing multiple rounds)

## Game Flow

1. **Initialization**
   - Scene setup with waypoints and characters
   - Random selection of target waypoint
   - NPCs begin autonomous movement (avoiding target)

2. **Gameplay Loop**
   - Player navigates to NPCs
   - Player initiates conversation
   - Player inputs persuasive text
   - LLM processes input and determines NPC response
   - NPC either changes destination or continues avoidance
   - Loop continues until all NPCs are at target or time expires

3. **Round Completion**
   - Success/failure determination
   - Score calculation (if implementing scoring)
   - Option to play another round

## NPC Decision Making

The LLM will receive a carefully crafted prompt containing:
- NPC personality traits
- Current location and movement history
- Conversation history with player
- Available waypoints and their descriptions
- Which waypoint is the target (to be initially avoided)

Based on this information, the LLM will:
1. Generate a contextually appropriate verbal response
2. Decide whether the player's persuasion was effective
3. Choose a new destination waypoint if persuaded
4. Provide reasoning for its decision (for debugging)

## Technical Implementation

### Three.js Setup
- Scene initialization with appropriate lighting
- Camera configuration for top-down view
- Material and geometry setup for characters and waypoints
- Animation system for movement and rotation

### State Management
- Game state tracking (positions, objectives, statuses)
- NPC state management (movement targets, persuasion status)
- Conversation state handling

### AI Integration
- Prompt engineering for consistent NPC behavior
- Response parsing and application to game state
- Error handling for API limitations

## Development Roadmap

### Phase 1: Basic Environment
- Three.js scene setup
- Simple character and waypoint representation
- Basic movement controls

### Phase 2: NPC Behavior
- Autonomous movement between waypoints
- Target waypoint avoidance
- Interaction triggers

### Phase 3: Dialogue System
- Text input/output interface
- Timer implementation
- LLM integration for basic responses

### Phase 4: Persuasion Mechanics
- Complete LLM integration with decision-making
- NPC state changes based on persuasion
- Memory system implementation

### Phase 5: Game Logic
- Win conditions
- Round structure
- Feedback systems

### Phase 6: Polish
- Visual improvements
- UI refinement
- Performance optimization

## Future Enhancements

- Multiple difficulty levels
- More complex NPC personalities
- Environmental obstacles
- Special abilities for the player
- Mobile compatibility
- Multiplayer support 