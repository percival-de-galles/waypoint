#pragma once

#include "WaypointMarkdownTextRunShadowNode.h"

#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

namespace facebook::react {
using WaypointMarkdownTextRunComponentDescriptor = ConcreteComponentDescriptor<WaypointMarkdownTextRunShadowNode>;

void WaypointMarkdownTextRunSpec_registerComponentDescriptorsFromCodegen(
  std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
}
