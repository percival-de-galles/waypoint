#pragma once

#include <react/renderer/components/WaypointMarkdownTextSpec/EventEmitters.h>
#include <react/renderer/components/WaypointMarkdownTextSpec/Props.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/ShadowNode.h>

#include <string>
#include <vector>

namespace facebook::react {

extern const char WaypointMarkdownTextComponentName[];

struct WaypointMarkdownTextParagraphStyleRange {
  size_t location;
  size_t length;
  Float firstLineHeadIndent;
  Float headIndent;
  Float paragraphSpacing;
};

struct WaypointMarkdownTextAttachmentRange {
  size_t location;
  size_t length;
  std::string imageUri;
  /// Recolor the loaded image with the run's foreground color, like `sf:` symbols.
  bool tintWithForeground;
};

inline Float WaypointMarkdownTextAttachmentSize(const WaypointMarkdownTextAttachmentRange &) {
  return 14;
}

inline Float WaypointMarkdownTextAttachmentBaselineOffset(
    const WaypointMarkdownTextAttachmentRange &) {
  return -2;
}

class WaypointMarkdownTextStateReal final {
 public:
  AttributedString attributedString;
  std::vector<WaypointMarkdownTextParagraphStyleRange> paragraphStyleRanges;
  std::vector<WaypointMarkdownTextAttachmentRange> attachmentRanges;
};

class WaypointMarkdownTextShadowNode final : public ConcreteViewShadowNode<
WaypointMarkdownTextComponentName,
WaypointMarkdownTextProps,
WaypointMarkdownTextEventEmitter,
WaypointMarkdownTextStateReal> {
public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  WaypointMarkdownTextShadowNode(
   const ShadowNode& sourceShadowNode,
   const ShadowNodeFragment& fragment
  );

  static ShadowNodeTraits BaseTraits() {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  void layout(LayoutContext layoutContext) override;

  Size measureContent(
      const LayoutContext& layoutContext,
      const LayoutConstraints& layoutConstraints) const override;

private:
  mutable AttributedString _attributedString;
  mutable std::vector<WaypointMarkdownTextParagraphStyleRange> _paragraphStyleRanges;
  mutable std::vector<WaypointMarkdownTextAttachmentRange> _attachmentRanges;
};
} // namespace facebook::React
