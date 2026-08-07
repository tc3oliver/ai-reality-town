/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiTown_agent from "../aiTown/agent.js";
import type * as aiTown_agentDescription from "../aiTown/agentDescription.js";
import type * as aiTown_conversation from "../aiTown/conversation.js";
import type * as aiTown_conversationMembership from "../aiTown/conversationMembership.js";
import type * as aiTown_ids from "../aiTown/ids.js";
import type * as aiTown_player from "../aiTown/player.js";
import type * as aiTown_playerDescription from "../aiTown/playerDescription.js";
import type * as aiTown_world from "../aiTown/world.js";
import type * as aiTown_worldMap from "../aiTown/worldMap.js";
import type * as canon_characterSeed from "../canon/characterSeed.js";
import type * as canon_commit from "../canon/commit.js";
import type * as canon_eventTypes from "../canon/eventTypes.js";
import type * as canon_inMemoryStore from "../canon/inMemoryStore.js";
import type * as canon_mistwoodFixture from "../canon/mistwoodFixture.js";
import type * as canon_mistwoodSeed from "../canon/mistwoodSeed.js";
import type * as canon_model from "../canon/model.js";
import type * as canon_proposedEvent from "../canon/proposedEvent.js";
import type * as canon_publicWorldRegistry from "../canon/publicWorldRegistry.js";
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
import type * as editorial_episode from "../editorial/episode.js";
import type * as editorial_episodeFunctions from "../editorial/episodeFunctions.js";
import type * as editorial_publicationLifecycle from "../editorial/publicationLifecycle.js";
import type * as editorial_publicationLifecycleFunctions from "../editorial/publicationLifecycleFunctions.js";
import type * as http from "../http.js";
import type * as init from "../init.js";
import type * as knowledge_authorization from "../knowledge/authorization.js";
import type * as knowledge_memoryAuthorization from "../knowledge/memoryAuthorization.js";
import type * as knowledge_memoryQueries from "../knowledge/memoryQueries.js";
import type * as knowledge_memoryRetrieval from "../knowledge/memoryRetrieval.js";
import type * as knowledge_queries from "../knowledge/queries.js";
import type * as observability_llmTrace from "../observability/llmTrace.js";
import type * as observability_model from "../observability/model.js";
import type * as observability_trace from "../observability/trace.js";
import type * as observability_traces from "../observability/traces.js";
import type * as operations_canonCorrection from "../operations/canonCorrection.js";
import type * as operations_canonCorrectionFunctions from "../operations/canonCorrectionFunctions.js";
import type * as operations_emergencyStopFunctions from "../operations/emergencyStopFunctions.js";
import type * as operations_longRunHarness from "../operations/longRunHarness.js";
import type * as operations_narrativeReviewSample from "../operations/narrativeReviewSample.js";
import type * as operations_operatorAuthorization from "../operations/operatorAuthorization.js";
import type * as operations_opsConsole from "../operations/opsConsole.js";
import type * as operations_opsConsoleFunctions from "../operations/opsConsoleFunctions.js";
import type * as operations_postCommitLive from "../operations/postCommitLive.js";
import type * as operations_postCommitLiveFunctions from "../operations/postCommitLiveFunctions.js";
import type * as operations_postCommitOrchestration from "../operations/postCommitOrchestration.js";
import type * as operations_postCommitOrchestrationFunctions from "../operations/postCommitOrchestrationFunctions.js";
import type * as operations_proposalReview from "../operations/proposalReview.js";
import type * as operations_proposalReviewFunctions from "../operations/proposalReviewFunctions.js";
import type * as operations_proposalReviewStore from "../operations/proposalReviewStore.js";
import type * as publicRead_arcPrimer from "../publicRead/arcPrimer.js";
import type * as publicRead_arcPrimerFunctions from "../publicRead/arcPrimerFunctions.js";
import type * as publicRead_episodeIndexProjection from "../publicRead/episodeIndexProjection.js";
import type * as publicRead_episodeIndexProjectionFunctions from "../publicRead/episodeIndexProjectionFunctions.js";
import type * as publicRead_episodeTimelineProjection from "../publicRead/episodeTimelineProjection.js";
import type * as publicRead_episodeTimelineProjectionFunctions from "../publicRead/episodeTimelineProjectionFunctions.js";
import type * as publicRead_liveState from "../publicRead/liveState.js";
import type * as publicRead_liveStateFunctions from "../publicRead/liveStateFunctions.js";
import type * as publicRead_onboardingSummary from "../publicRead/onboardingSummary.js";
import type * as publicRead_onboardingSummaryFunctions from "../publicRead/onboardingSummaryFunctions.js";
import type * as publicRead_publicDynamicProjection from "../publicRead/publicDynamicProjection.js";
import type * as publicRead_publicDynamicProjectionValidators from "../publicRead/publicDynamicProjectionValidators.js";
import type * as publicRead_readModel from "../publicRead/readModel.js";
import type * as publicRead_readModelFunctions from "../publicRead/readModelFunctions.js";
import type * as publicRead_relationshipArcProjection from "../publicRead/relationshipArcProjection.js";
import type * as publicRead_relationshipArcProjectionFunctions from "../publicRead/relationshipArcProjectionFunctions.js";
import type * as publicRead_runtimeSnapshot from "../publicRead/runtimeSnapshot.js";
import type * as publicRead_runtimeSnapshotFunctions from "../publicRead/runtimeSnapshotFunctions.js";
import type * as publicRead_runtimeSnapshotValidators from "../publicRead/runtimeSnapshotValidators.js";
import type * as publicRead_worldCharacterProjection from "../publicRead/worldCharacterProjection.js";
import type * as publicRead_worldCharacterProjectionFunctions from "../publicRead/worldCharacterProjectionFunctions.js";
import type * as recaps_coverageValidation from "../recaps/coverageValidation.js";
import type * as recaps_coverageValidationFunctions from "../recaps/coverageValidationFunctions.js";
import type * as recaps_functions from "../recaps/functions.js";
import type * as recaps_model from "../recaps/model.js";
import type * as recaps_recapFormats from "../recaps/recapFormats.js";
import type * as safety_postGeneration from "../safety/postGeneration.js";
import type * as safety_postGenerationFunctions from "../safety/postGenerationFunctions.js";
import type * as safety_preGeneration from "../safety/preGeneration.js";
import type * as safety_viewerInput from "../safety/viewerInput.js";
import type * as shared_constants from "../shared/constants.js";
import type * as shared_errors from "../shared/errors.js";
import type * as shared_ids from "../shared/ids.js";
import type * as shared_internalFunctionRef from "../shared/internalFunctionRef.js";
import type * as simulation_characterIntent from "../simulation/characterIntent.js";
import type * as simulation_characterIntentFunctions from "../simulation/characterIntentFunctions.js";
import type * as simulation_director from "../simulation/director.js";
import type * as simulation_directorFunctions from "../simulation/directorFunctions.js";
import type * as simulation_emergencyStop from "../simulation/emergencyStop.js";
import type * as simulation_emergencyStopOperations from "../simulation/emergencyStopOperations.js";
import type * as simulation_fakeProvider from "../simulation/fakeProvider.js";
import type * as simulation_fakeSceneNarrator from "../simulation/fakeSceneNarrator.js";
import type * as simulation_model from "../simulation/model.js";
import type * as simulation_provider from "../simulation/provider.js";
import type * as simulation_providers_actions from "../simulation/providers/actions.js";
import type * as simulation_providers_config from "../simulation/providers/config.js";
import type * as simulation_providers_openAICompatible from "../simulation/providers/openAICompatible.js";
import type * as simulation_providers_probes from "../simulation/providers/probes.js";
import type * as simulation_queries from "../simulation/queries.js";
import type * as simulation_runState from "../simulation/runState.js";
import type * as simulation_sceneGrouping from "../simulation/sceneGrouping.js";
import type * as simulation_sceneGroupingFunctions from "../simulation/sceneGroupingFunctions.js";
import type * as simulation_sceneSimulation from "../simulation/sceneSimulation.js";
import type * as simulation_sceneSimulationFunctions from "../simulation/sceneSimulationFunctions.js";
import type * as simulation_scheduler from "../simulation/scheduler.js";
import type * as simulation_schedulerOperations from "../simulation/schedulerOperations.js";
import type * as simulation_warmup from "../simulation/warmup.js";
import type * as simulation_warmupFunctions from "../simulation/warmupFunctions.js";
import type * as simulation_workflow from "../simulation/workflow.js";
import type * as simulation_worldDayLive from "../simulation/worldDayLive.js";
import type * as simulation_worldDayLiveFunctions from "../simulation/worldDayLiveFunctions.js";
import type * as simulation_worldDayOrchestration from "../simulation/worldDayOrchestration.js";
import type * as simulation_worldDayOrchestrationFunctions from "../simulation/worldDayOrchestrationFunctions.js";
import type * as story_classification from "../story/classification.js";
import type * as story_classificationFunctions from "../story/classificationFunctions.js";
import type * as story_consequenceSummary from "../story/consequenceSummary.js";
import type * as story_consequenceSummaryFunctions from "../story/consequenceSummaryFunctions.js";
import type * as story_entryRecommendation from "../story/entryRecommendation.js";
import type * as story_entryRecommendationFunctions from "../story/entryRecommendationFunctions.js";
import type * as story_functions from "../story/functions.js";
import type * as story_lifecycle from "../story/lifecycle.js";
import type * as story_model from "../story/model.js";
import type * as story_portfolio from "../story/portfolio.js";
import type * as story_portfolioFunctions from "../story/portfolioFunctions.js";
import type * as story_projection from "../story/projection.js";
import type * as story_projectionFunctions from "../story/projectionFunctions.js";
import type * as story_resolution from "../story/resolution.js";
import type * as story_resolutionFunctions from "../story/resolutionFunctions.js";
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
import type * as viewer_spoilerMode from "../viewer/spoilerMode.js";
import type * as visual_characterVisualBinding from "../visual/characterVisualBinding.js";
import type * as visual_locationVisualBinding from "../visual/locationVisualBinding.js";
import type * as visual_mistwoodLocationBindings from "../visual/mistwoodLocationBindings.js";
import type * as visual_mistwoodVisualBindings from "../visual/mistwoodVisualBindings.js";
import type * as visualRuntime_ambientAnchor from "../visualRuntime/ambientAnchor.js";
import type * as visualRuntime_fixtures from "../visualRuntime/fixtures.js";
import type * as visualRuntime_mistwoodRuntime from "../visualRuntime/mistwoodRuntime.js";
import type * as visualRuntime_motion from "../visualRuntime/motion.js";
import type * as visualRuntime_pathPlanner from "../visualRuntime/pathPlanner.js";
import type * as visualRuntime_seedBootstrap from "../visualRuntime/seedBootstrap.js";
import type * as visualRuntime_seededRandom from "../visualRuntime/seededRandom.js";
import type * as visualRuntime_visualSyncPlanner from "../visualRuntime/visualSyncPlanner.js";
import type * as visualRuntime_walkableGrid from "../visualRuntime/walkableGrid.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "aiTown/agent": typeof aiTown_agent;
  "aiTown/agentDescription": typeof aiTown_agentDescription;
  "aiTown/conversation": typeof aiTown_conversation;
  "aiTown/conversationMembership": typeof aiTown_conversationMembership;
  "aiTown/ids": typeof aiTown_ids;
  "aiTown/player": typeof aiTown_player;
  "aiTown/playerDescription": typeof aiTown_playerDescription;
  "aiTown/world": typeof aiTown_world;
  "aiTown/worldMap": typeof aiTown_worldMap;
  "canon/characterSeed": typeof canon_characterSeed;
  "canon/commit": typeof canon_commit;
  "canon/eventTypes": typeof canon_eventTypes;
  "canon/inMemoryStore": typeof canon_inMemoryStore;
  "canon/mistwoodFixture": typeof canon_mistwoodFixture;
  "canon/mistwoodSeed": typeof canon_mistwoodSeed;
  "canon/model": typeof canon_model;
  "canon/proposedEvent": typeof canon_proposedEvent;
  "canon/publicWorldRegistry": typeof canon_publicWorldRegistry;
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
  "editorial/episode": typeof editorial_episode;
  "editorial/episodeFunctions": typeof editorial_episodeFunctions;
  "editorial/publicationLifecycle": typeof editorial_publicationLifecycle;
  "editorial/publicationLifecycleFunctions": typeof editorial_publicationLifecycleFunctions;
  http: typeof http;
  init: typeof init;
  "knowledge/authorization": typeof knowledge_authorization;
  "knowledge/memoryAuthorization": typeof knowledge_memoryAuthorization;
  "knowledge/memoryQueries": typeof knowledge_memoryQueries;
  "knowledge/memoryRetrieval": typeof knowledge_memoryRetrieval;
  "knowledge/queries": typeof knowledge_queries;
  "observability/llmTrace": typeof observability_llmTrace;
  "observability/model": typeof observability_model;
  "observability/trace": typeof observability_trace;
  "observability/traces": typeof observability_traces;
  "operations/canonCorrection": typeof operations_canonCorrection;
  "operations/canonCorrectionFunctions": typeof operations_canonCorrectionFunctions;
  "operations/emergencyStopFunctions": typeof operations_emergencyStopFunctions;
  "operations/longRunHarness": typeof operations_longRunHarness;
  "operations/narrativeReviewSample": typeof operations_narrativeReviewSample;
  "operations/operatorAuthorization": typeof operations_operatorAuthorization;
  "operations/opsConsole": typeof operations_opsConsole;
  "operations/opsConsoleFunctions": typeof operations_opsConsoleFunctions;
  "operations/postCommitLive": typeof operations_postCommitLive;
  "operations/postCommitLiveFunctions": typeof operations_postCommitLiveFunctions;
  "operations/postCommitOrchestration": typeof operations_postCommitOrchestration;
  "operations/postCommitOrchestrationFunctions": typeof operations_postCommitOrchestrationFunctions;
  "operations/proposalReview": typeof operations_proposalReview;
  "operations/proposalReviewFunctions": typeof operations_proposalReviewFunctions;
  "operations/proposalReviewStore": typeof operations_proposalReviewStore;
  "publicRead/arcPrimer": typeof publicRead_arcPrimer;
  "publicRead/arcPrimerFunctions": typeof publicRead_arcPrimerFunctions;
  "publicRead/episodeIndexProjection": typeof publicRead_episodeIndexProjection;
  "publicRead/episodeIndexProjectionFunctions": typeof publicRead_episodeIndexProjectionFunctions;
  "publicRead/episodeTimelineProjection": typeof publicRead_episodeTimelineProjection;
  "publicRead/episodeTimelineProjectionFunctions": typeof publicRead_episodeTimelineProjectionFunctions;
  "publicRead/liveState": typeof publicRead_liveState;
  "publicRead/liveStateFunctions": typeof publicRead_liveStateFunctions;
  "publicRead/onboardingSummary": typeof publicRead_onboardingSummary;
  "publicRead/onboardingSummaryFunctions": typeof publicRead_onboardingSummaryFunctions;
  "publicRead/publicDynamicProjection": typeof publicRead_publicDynamicProjection;
  "publicRead/publicDynamicProjectionValidators": typeof publicRead_publicDynamicProjectionValidators;
  "publicRead/readModel": typeof publicRead_readModel;
  "publicRead/readModelFunctions": typeof publicRead_readModelFunctions;
  "publicRead/relationshipArcProjection": typeof publicRead_relationshipArcProjection;
  "publicRead/relationshipArcProjectionFunctions": typeof publicRead_relationshipArcProjectionFunctions;
  "publicRead/runtimeSnapshot": typeof publicRead_runtimeSnapshot;
  "publicRead/runtimeSnapshotFunctions": typeof publicRead_runtimeSnapshotFunctions;
  "publicRead/runtimeSnapshotValidators": typeof publicRead_runtimeSnapshotValidators;
  "publicRead/worldCharacterProjection": typeof publicRead_worldCharacterProjection;
  "publicRead/worldCharacterProjectionFunctions": typeof publicRead_worldCharacterProjectionFunctions;
  "recaps/coverageValidation": typeof recaps_coverageValidation;
  "recaps/coverageValidationFunctions": typeof recaps_coverageValidationFunctions;
  "recaps/functions": typeof recaps_functions;
  "recaps/model": typeof recaps_model;
  "recaps/recapFormats": typeof recaps_recapFormats;
  "safety/postGeneration": typeof safety_postGeneration;
  "safety/postGenerationFunctions": typeof safety_postGenerationFunctions;
  "safety/preGeneration": typeof safety_preGeneration;
  "safety/viewerInput": typeof safety_viewerInput;
  "shared/constants": typeof shared_constants;
  "shared/errors": typeof shared_errors;
  "shared/ids": typeof shared_ids;
  "shared/internalFunctionRef": typeof shared_internalFunctionRef;
  "simulation/characterIntent": typeof simulation_characterIntent;
  "simulation/characterIntentFunctions": typeof simulation_characterIntentFunctions;
  "simulation/director": typeof simulation_director;
  "simulation/directorFunctions": typeof simulation_directorFunctions;
  "simulation/emergencyStop": typeof simulation_emergencyStop;
  "simulation/emergencyStopOperations": typeof simulation_emergencyStopOperations;
  "simulation/fakeProvider": typeof simulation_fakeProvider;
  "simulation/fakeSceneNarrator": typeof simulation_fakeSceneNarrator;
  "simulation/model": typeof simulation_model;
  "simulation/provider": typeof simulation_provider;
  "simulation/providers/actions": typeof simulation_providers_actions;
  "simulation/providers/config": typeof simulation_providers_config;
  "simulation/providers/openAICompatible": typeof simulation_providers_openAICompatible;
  "simulation/providers/probes": typeof simulation_providers_probes;
  "simulation/queries": typeof simulation_queries;
  "simulation/runState": typeof simulation_runState;
  "simulation/sceneGrouping": typeof simulation_sceneGrouping;
  "simulation/sceneGroupingFunctions": typeof simulation_sceneGroupingFunctions;
  "simulation/sceneSimulation": typeof simulation_sceneSimulation;
  "simulation/sceneSimulationFunctions": typeof simulation_sceneSimulationFunctions;
  "simulation/scheduler": typeof simulation_scheduler;
  "simulation/schedulerOperations": typeof simulation_schedulerOperations;
  "simulation/warmup": typeof simulation_warmup;
  "simulation/warmupFunctions": typeof simulation_warmupFunctions;
  "simulation/workflow": typeof simulation_workflow;
  "simulation/worldDayLive": typeof simulation_worldDayLive;
  "simulation/worldDayLiveFunctions": typeof simulation_worldDayLiveFunctions;
  "simulation/worldDayOrchestration": typeof simulation_worldDayOrchestration;
  "simulation/worldDayOrchestrationFunctions": typeof simulation_worldDayOrchestrationFunctions;
  "story/classification": typeof story_classification;
  "story/classificationFunctions": typeof story_classificationFunctions;
  "story/consequenceSummary": typeof story_consequenceSummary;
  "story/consequenceSummaryFunctions": typeof story_consequenceSummaryFunctions;
  "story/entryRecommendation": typeof story_entryRecommendation;
  "story/entryRecommendationFunctions": typeof story_entryRecommendationFunctions;
  "story/functions": typeof story_functions;
  "story/lifecycle": typeof story_lifecycle;
  "story/model": typeof story_model;
  "story/portfolio": typeof story_portfolio;
  "story/portfolioFunctions": typeof story_portfolioFunctions;
  "story/projection": typeof story_projection;
  "story/projectionFunctions": typeof story_projectionFunctions;
  "story/resolution": typeof story_resolution;
  "story/resolutionFunctions": typeof story_resolutionFunctions;
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
  "viewer/spoilerMode": typeof viewer_spoilerMode;
  "visual/characterVisualBinding": typeof visual_characterVisualBinding;
  "visual/locationVisualBinding": typeof visual_locationVisualBinding;
  "visual/mistwoodLocationBindings": typeof visual_mistwoodLocationBindings;
  "visual/mistwoodVisualBindings": typeof visual_mistwoodVisualBindings;
  "visualRuntime/ambientAnchor": typeof visualRuntime_ambientAnchor;
  "visualRuntime/fixtures": typeof visualRuntime_fixtures;
  "visualRuntime/mistwoodRuntime": typeof visualRuntime_mistwoodRuntime;
  "visualRuntime/motion": typeof visualRuntime_motion;
  "visualRuntime/pathPlanner": typeof visualRuntime_pathPlanner;
  "visualRuntime/seedBootstrap": typeof visualRuntime_seedBootstrap;
  "visualRuntime/seededRandom": typeof visualRuntime_seededRandom;
  "visualRuntime/visualSyncPlanner": typeof visualRuntime_visualSyncPlanner;
  "visualRuntime/walkableGrid": typeof visualRuntime_walkableGrid;
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
