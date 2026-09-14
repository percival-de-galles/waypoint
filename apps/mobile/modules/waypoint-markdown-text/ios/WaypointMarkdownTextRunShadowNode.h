#pragma once

#include <react/renderer/components/WaypointMarkdownTextSpec/EventEmitters.h>
#include <react/renderer/components/WaypointMarkdownTextSpec/Props.h>
#include <react/renderer/components/WaypointMarkdownTextSpec/States.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>

namespace facebook::react {
extern const char WaypointMarkdownTextRunComponentName[];

using WaypointMarkdownTextRunShadowNode = ConcreteViewShadowNode<
    WaypointMarkdownTextRunComponentName,
    WaypointMarkdownTextRunProps,
    WaypointMarkdownTextRunEventEmitter,
    WaypointMarkdownTextRunState>;
}
