/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent_conversation from "../agent/conversation.js";
import type * as agent_embeddingsCache from "../agent/embeddingsCache.js";
import type * as agent_memory from "../agent/memory.js";
import type * as aiTown_agent from "../aiTown/agent.js";
import type * as aiTown_agentDescription from "../aiTown/agentDescription.js";
import type * as aiTown_agentInputs from "../aiTown/agentInputs.js";
import type * as aiTown_agentOperations from "../aiTown/agentOperations.js";
import type * as aiTown_conversation from "../aiTown/conversation.js";
import type * as aiTown_conversationMembership from "../aiTown/conversationMembership.js";
import type * as aiTown_game from "../aiTown/game.js";
import type * as aiTown_ids from "../aiTown/ids.js";
import type * as aiTown_inputHandler from "../aiTown/inputHandler.js";
import type * as aiTown_inputs from "../aiTown/inputs.js";
import type * as aiTown_insertInput from "../aiTown/insertInput.js";
import type * as aiTown_location from "../aiTown/location.js";
import type * as aiTown_main from "../aiTown/main.js";
import type * as aiTown_movement from "../aiTown/movement.js";
import type * as aiTown_player from "../aiTown/player.js";
import type * as aiTown_playerDescription from "../aiTown/playerDescription.js";
import type * as aiTown_world from "../aiTown/world.js";
import type * as aiTown_worldMap from "../aiTown/worldMap.js";
import type * as canon_characterSeed from "../canon/characterSeed.js";
import type * as canon_commit from "../canon/commit.js";
import type * as canon_eventTypes from "../canon/eventTypes.js";
import type * as canon_inMemoryStore from "../canon/inMemoryStore.js";
import type * as canon_mistwoodFixture from "../canon/mistwoodFixture.js";
import type * as canon_model from "../canon/model.js";
import type * as canon_proposedEvent from "../canon/proposedEvent.js";
import type * as canon_queries from "../canon/queries.js";
import type * as canon_reducer from "../canon/reducer.js";
import type * as canon_replay from "../canon/replay.js";
import type * as canon_serialize from "../canon/serialize.js";
import type * as canon_snapshotManager from "../canon/snapshotManager.js";
import type * as canon_snapshotOperations from "../canon/snapshotOperations.js";
import type * as canon_snapshots from "../canon/snapshots.js";
import type * as canon_tensionReadiness from "../canon/tensionReadiness.js";
import type * as canon_validators from "../canon/validators.js";
import type * as canon_worldConfig from "../canon/worldConfig.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as engine_abstractGame from "../engine/abstractGame.js";
import type * as engine_historicalObject from "../engine/historicalObject.js";
import type * as http from "../http.js";
import type * as init from "../init.js";
import type * as knowledge_authorization from "../knowledge/authorization.js";
import type * as knowledge_memoryAuthorization from "../knowledge/memoryAuthorization.js";
import type * as knowledge_memoryQueries from "../knowledge/memoryQueries.js";
import type * as knowledge_memoryRetrieval from "../knowledge/memoryRetrieval.js";
import type * as knowledge_queries from "../knowledge/queries.js";
import type * as messages from "../messages.js";
import type * as music from "../music.js";
import type * as observability_llmTrace from "../observability/llmTrace.js";
import type * as observability_model from "../observability/model.js";
import type * as observability_trace from "../observability/trace.js";
import type * as observability_traces from "../observability/traces.js";
import type * as recaps_model from "../recaps/model.js";
import type * as safety_postGeneration from "../safety/postGeneration.js";
import type * as safety_postGenerationFunctions from "../safety/postGenerationFunctions.js";
import type * as safety_preGeneration from "../safety/preGeneration.js";
import type * as shared_constants from "../shared/constants.js";
import type * as shared_errors from "../shared/errors.js";
import type * as shared_ids from "../shared/ids.js";
import type * as simulation_characterIntent from "../simulation/characterIntent.js";
import type * as simulation_characterIntentFunctions from "../simulation/characterIntentFunctions.js";
import type * as simulation_director from "../simulation/director.js";
import type * as simulation_directorFunctions from "../simulation/directorFunctions.js";
import type * as simulation_fakeProvider from "../simulation/fakeProvider.js";
import type * as simulation_model from "../simulation/model.js";
import type * as simulation_provider from "../simulation/provider.js";
import type * as simulation_providers_actions from "../simulation/providers/actions.js";
import type * as simulation_providers_config from "../simulation/providers/config.js";
import type * as simulation_providers_openAICompatible from "../simulation/providers/openAICompatible.js";
import type * as simulation_providers_probes from "../simulation/providers/probes.js";
import type * as simulation_queries from "../simulation/queries.js";
import type * as simulation_runState from "../simulation/runState.js";
import type * as simulation_scheduler from "../simulation/scheduler.js";
import type * as simulation_schedulerOperations from "../simulation/schedulerOperations.js";
import type * as simulation_workflow from "../simulation/workflow.js";
import type * as story_classification from "../story/classification.js";
import type * as story_classificationFunctions from "../story/classificationFunctions.js";
import type * as story_functions from "../story/functions.js";
import type * as story_lifecycle from "../story/lifecycle.js";
import type * as story_model from "../story/model.js";
import type * as story_portfolio from "../story/portfolio.js";
import type * as story_portfolioFunctions from "../story/portfolioFunctions.js";
import type * as story_projection from "../story/projection.js";
import type * as story_projectionFunctions from "../story/projectionFunctions.js";
import type * as story_resolution from "../story/resolution.js";
import type * as story_resolutionFunctions from "../story/resolutionFunctions.js";
import type * as testing from "../testing.js";
import type * as util_FastIntegerCompression from "../util/FastIntegerCompression.js";
import type * as util_assertNever from "../util/assertNever.js";
import type * as util_asyncMap from "../util/asyncMap.js";
import type * as util_compression from "../util/compression.js";
import type * as util_geometry from "../util/geometry.js";
import type * as util_isSimpleObject from "../util/isSimpleObject.js";
import type * as util_llm from "../util/llm.js";
import type * as util_minheap from "../util/minheap.js";
import type * as util_object from "../util/object.js";
import type * as util_sleep from "../util/sleep.js";
import type * as util_types from "../util/types.js";
import type * as util_xxhash from "../util/xxhash.js";
import type * as world from "../world.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agent/conversation": typeof agent_conversation;
  "agent/embeddingsCache": typeof agent_embeddingsCache;
  "agent/memory": typeof agent_memory;
  "aiTown/agent": typeof aiTown_agent;
  "aiTown/agentDescription": typeof aiTown_agentDescription;
  "aiTown/agentInputs": typeof aiTown_agentInputs;
  "aiTown/agentOperations": typeof aiTown_agentOperations;
  "aiTown/conversation": typeof aiTown_conversation;
  "aiTown/conversationMembership": typeof aiTown_conversationMembership;
  "aiTown/game": typeof aiTown_game;
  "aiTown/ids": typeof aiTown_ids;
  "aiTown/inputHandler": typeof aiTown_inputHandler;
  "aiTown/inputs": typeof aiTown_inputs;
  "aiTown/insertInput": typeof aiTown_insertInput;
  "aiTown/location": typeof aiTown_location;
  "aiTown/main": typeof aiTown_main;
  "aiTown/movement": typeof aiTown_movement;
  "aiTown/player": typeof aiTown_player;
  "aiTown/playerDescription": typeof aiTown_playerDescription;
  "aiTown/world": typeof aiTown_world;
  "aiTown/worldMap": typeof aiTown_worldMap;
  "canon/characterSeed": typeof canon_characterSeed;
  "canon/commit": typeof canon_commit;
  "canon/eventTypes": typeof canon_eventTypes;
  "canon/inMemoryStore": typeof canon_inMemoryStore;
  "canon/mistwoodFixture": typeof canon_mistwoodFixture;
  "canon/model": typeof canon_model;
  "canon/proposedEvent": typeof canon_proposedEvent;
  "canon/queries": typeof canon_queries;
  "canon/reducer": typeof canon_reducer;
  "canon/replay": typeof canon_replay;
  "canon/serialize": typeof canon_serialize;
  "canon/snapshotManager": typeof canon_snapshotManager;
  "canon/snapshotOperations": typeof canon_snapshotOperations;
  "canon/snapshots": typeof canon_snapshots;
  "canon/tensionReadiness": typeof canon_tensionReadiness;
  "canon/validators": typeof canon_validators;
  "canon/worldConfig": typeof canon_worldConfig;
  constants: typeof constants;
  crons: typeof crons;
  "engine/abstractGame": typeof engine_abstractGame;
  "engine/historicalObject": typeof engine_historicalObject;
  http: typeof http;
  init: typeof init;
  "knowledge/authorization": typeof knowledge_authorization;
  "knowledge/memoryAuthorization": typeof knowledge_memoryAuthorization;
  "knowledge/memoryQueries": typeof knowledge_memoryQueries;
  "knowledge/memoryRetrieval": typeof knowledge_memoryRetrieval;
  "knowledge/queries": typeof knowledge_queries;
  messages: typeof messages;
  music: typeof music;
  "observability/llmTrace": typeof observability_llmTrace;
  "observability/model": typeof observability_model;
  "observability/trace": typeof observability_trace;
  "observability/traces": typeof observability_traces;
  "recaps/model": typeof recaps_model;
  "safety/postGeneration": typeof safety_postGeneration;
  "safety/postGenerationFunctions": typeof safety_postGenerationFunctions;
  "safety/preGeneration": typeof safety_preGeneration;
  "shared/constants": typeof shared_constants;
  "shared/errors": typeof shared_errors;
  "shared/ids": typeof shared_ids;
  "simulation/characterIntent": typeof simulation_characterIntent;
  "simulation/characterIntentFunctions": typeof simulation_characterIntentFunctions;
  "simulation/director": typeof simulation_director;
  "simulation/directorFunctions": typeof simulation_directorFunctions;
  "simulation/fakeProvider": typeof simulation_fakeProvider;
  "simulation/model": typeof simulation_model;
  "simulation/provider": typeof simulation_provider;
  "simulation/providers/actions": typeof simulation_providers_actions;
  "simulation/providers/config": typeof simulation_providers_config;
  "simulation/providers/openAICompatible": typeof simulation_providers_openAICompatible;
  "simulation/providers/probes": typeof simulation_providers_probes;
  "simulation/queries": typeof simulation_queries;
  "simulation/runState": typeof simulation_runState;
  "simulation/scheduler": typeof simulation_scheduler;
  "simulation/schedulerOperations": typeof simulation_schedulerOperations;
  "simulation/workflow": typeof simulation_workflow;
  "story/classification": typeof story_classification;
  "story/classificationFunctions": typeof story_classificationFunctions;
  "story/functions": typeof story_functions;
  "story/lifecycle": typeof story_lifecycle;
  "story/model": typeof story_model;
  "story/portfolio": typeof story_portfolio;
  "story/portfolioFunctions": typeof story_portfolioFunctions;
  "story/projection": typeof story_projection;
  "story/projectionFunctions": typeof story_projectionFunctions;
  "story/resolution": typeof story_resolution;
  "story/resolutionFunctions": typeof story_resolutionFunctions;
  testing: typeof testing;
  "util/FastIntegerCompression": typeof util_FastIntegerCompression;
  "util/assertNever": typeof util_assertNever;
  "util/asyncMap": typeof util_asyncMap;
  "util/compression": typeof util_compression;
  "util/geometry": typeof util_geometry;
  "util/isSimpleObject": typeof util_isSimpleObject;
  "util/llm": typeof util_llm;
  "util/minheap": typeof util_minheap;
  "util/object": typeof util_object;
  "util/sleep": typeof util_sleep;
  "util/types": typeof util_types;
  "util/xxhash": typeof util_xxhash;
  world: typeof world;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
