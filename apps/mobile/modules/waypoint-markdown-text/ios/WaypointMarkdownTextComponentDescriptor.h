#pragma once

#include "WaypointMarkdownTextShadowNode.h"

#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

namespace facebook::react {
using WaypointMarkdownTextComponentDescriptor = ConcreteComponentDescriptor<WaypointMarkdownTextShadowNode>;

void WaypointMarkdownTextSpec_registerComponentDescriptorsFromCodegen(
  std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
}
