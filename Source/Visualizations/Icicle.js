$jit.Icicle = new Class({
  Implements: [ Loader, Extras, Layouts.Icicle ],

  layout: {
    orientation: "h",
    vertical: function(){
      return this.orientation == "v";
    },
    horizontal: function(){
      return this.orientation == "h";
    },
    change: function(){
      this.orientation = this.vertical()? "h" : "v";
    }
  },

  initialize: function(controller) {
    var config = {
      animate: false,
      orientation: "h",
      titleHeight: 13,
      offset: 2,
      levelsToShow: Number.MAX_VALUE,
      constrained: false,
      withLabels: true,
      clearCanvas: true,
      Node: {
        type: 'rectangle',
        overridable: true
      },
      Edge: {
        type: 'none'
      },
      Label: {
        type: 'Native'
      },
      duration: 700,
      fps: 25
    };

    var opts = Options("Canvas", "Node", "Edge", "Fx", "Tips", "NodeStyles",
                       "Events", "Navigation", "Controller", "Label");
    this.controller = this.config = $.merge(opts, config, controller);
    this.layout.orientation = this.config.orientation;

    var canvasConfig = this.config;
    if (canvasConfig.useCanvas) {
      this.canvas = canvasConfig.useCanvas;
      this.config.labelContainer = this.canvas.id + '-label';
    } else {
      this.canvas = new Canvas(this, canvasConfig);
      this.config.labelContainer = canvasConfig.injectInto + '-label';
    }

    this.graphOptions = {
      'complex': true,
      'Node': {
        'selected': false,
        'exist': true,
        'drawn': true
      }
    };

    this.graph = new Graph(
      this.graphOptions, this.config.Node, this.config.Edge, this.config.Label);

    this.labels = new $jit.Icicle.Label[this.config.Label.type](this);
    this.fx = new $jit.Icicle.Plot(this);
    this.op = new $jit.Icicle.Op(this);
    this.group = new $jit.Icicle.Group(this);
    this.clickedNode = null;

    this.initializeExtras();
  },

  refresh: function(){
    this.compute();
    this.plot();
  },

  plot: function(){
    this.fx.plot(this.config);
  },

  leaf: function(n){
    return Graph.Util.getSubnodes(n, [1, 1], "ignore").length == 0;
  },

  enter: function (node) {
    if (this.busy) return;
    this.busy = true;

    var that = this,
        config = this.config,
        clickedNode = node,
        previousClickedNode = this.clickedNode;

    var callback = {
      onComplete: function() {
        //compute positions of newly inserted nodes
        if(config.request) that.compute();
        if(config.animate) {
          //fade nodes
          that.graph.nodeList.setDataset(['current', 'end'], {
            'alpha': [1, 0]
          });
          Graph.Util.eachSubgraph(node, function(n) {
            n.setData('alpha', 1, 'end');
          }, "ignore");
          that.fx.animate({
            duration: 500,
            modes:['node-property:alpha'],
            onComplete: function() {
              //compute end positions
              that.clickedNode = clickedNode;
              that.compute('end');
              //animate positions
              that.clickedNode = previousClickedNode;
              that.fx.animate({
                modes:['linear', 'node-property:width:height'],
                duration: 1000,
                onComplete: function() {
                  that.busy = false;
                  that.clickedNode = clickedNode;
                }
              });
            }
          });
        } else {
          that.clickedNode = node;
          that.refresh();
          that.busy = false;
        }
      }
    };

    if(config.request) {
      this.requestNodes(clickedNode, callback);
    } else {
      callback.onComplete();
    }
  },

  out1: function () {
    if (this.clickedNode) {
      var parent = $jit.Graph.Util.getParents(icicle.clickedNode)[0];
      if (parent) {
        this.clickedNode = parent;
        this.enter(parent);
      }
    }
  },

  out: function(){
    if(this.busy) return;
    this.busy = true;
    this.events.hoveredNode = false;
    var that = this,
        GUtil = Graph.Util,
        config = this.config,
        graph = this.graph,
        parents = GUtil.getParents(graph.getNode(this.clickedNode && this.clickedNode.id || this.root)),
        parent = parents[0],
        clickedNode = parent,
        previousClickedNode = this.clickedNode;

    //if no parents return
    if(!parent) {
      this.busy = false;
      return;
    }
    //final plot callback
    callback = {
      onComplete: function() {
        that.clickedNode = parent;
        if(config.request) {
          that.requestNodes(parent, {
            onComplete: function() {
              that.compute();
              that.plot();
              that.busy = false;
            }
          });
        } else {
          that.compute();
          that.plot();
          that.busy = false;
        }
      }
    };
    //prune tree
    if (config.request)
      this.geom.setRightLevelToShow(parent);
    //animate node positions
    if(config.animate) {
      this.clickedNode = clickedNode;
      this.compute('end');
      //animate the visible subtree only
      this.clickedNode = previousClickedNode;
      this.fx.animate({
        modes:['linear', 'node-property:width:height'],
        duration: 1000,
        onComplete: function() {
          //animate the parent subtree
          that.clickedNode = clickedNode;
          //change nodes alpha
          graph.nodeList.setDataset(['current', 'end'], {
            'alpha': [0, 1]
          });
          GUtil.eachSubgraph(previousClickedNode, function(node) {
            node.setData('alpha', 1);
          }, "ignore");
          that.fx.animate({
            duration: 500,
            modes:['node-property:alpha'],
            onComplete: function() {
              callback.onComplete();
            }
          });
        }
      });
    } else {
      callback.onComplete();
    }
  },
  requestNodes: function(node, onComplete){
    var handler = $.merge(this.controller, onComplete), lev = this.config.levelsToShow;
    if (handler.request) {
      var leaves = [], d = node._depth;
      Graph.Util.eachLevel(node, 0, lev, function(n){
        if (n.drawn && !Graph.Util.anySubnode(n)) {
          leaves.push(n);
          n._level = lev - (n._depth - d);
        }
      });
      this.group.requestNodes(leaves, handler);
    } else {
      handler.onComplete();
    }
  },
});

$jit.Icicle.Op = new Class({
  Implements: Graph.Op,

  initialize: function(viz) {
    this.viz = viz;
  }
});

/*
 * Performs operations on group of nodes.
 */
$jit.Icicle.Group = new Class({

  initialize: function(viz){
    this.viz = viz;
    this.canvas = viz.canvas;
    this.config = viz.config;
  },

  /*
   * Calls the request method on the controller to request a subtree for each node.
   */
  requestNodes: function(nodes, controller){
    var counter = 0, len = nodes.length, nodeSelected = {};
    var complete = function(){
      controller.onComplete();
    };
    var viz = this.viz;
    if (len == 0)
      complete();
    for(var i = 0; i < len; i++) {
      nodeSelected[nodes[i].id] = nodes[i];
      controller.request(nodes[i].id, nodes[i]._level, {
        onComplete: function(nodeId, data){
          if (data && data.children) {
            data.id = nodeId;
            viz.op.sum(data, {
              type: 'nothing'
            });
          }
          if (++counter == len) {
            Graph.Util.computeLevels(viz.graph, viz.root, 0);
            complete();
          }
        }
      });
    }
  }
});

$jit.Icicle.Plot = new Class({
  Implements: Graph.Plot,

  initialize: function(viz){
    this.viz = viz;
    this.config = viz.config;
    this.node = this.config.Node;
    this.edge = this.config.Edge;
    this.animation = new Animation;
    this.nodeTypes = new $jit.Icicle.Plot.NodeTypes;
    this.edgeTypes = new $jit.Icicle.Plot.EdgeTypes;
    this.labels = viz.labels;
  },

  plot: function(opt, animating){
    var viz = this.viz, graph = viz.graph;
    var root = graph.getNode(viz.clickedNode && viz.clickedNode.id || viz.root);
    var initialDepth = root._depth;
    viz.canvas.clear();
    this.plotTree(root, $.merge(opt, {
      'withLabels': true,
      'hideLabels': !!animating,
      'plotSubtree': function(root, node) {
        return (node._depth - initialDepth < viz.config.levelsToShow);
      }
    }), animating);
  }
});

/*
 * Object: Icicle.Label
 *
 * Label interface implementation for the Icicle
 *
 * See Also:
 *
 * <Graph.Label>, <ST.Label.HTML>, <RGraph.Label.SVG>
 *
 */
$jit.Icicle.Label = {};

$jit.Icicle.Label.Native = new Class({
  Implements: Graph.Label.Native,

  renderLabel: function(canvas, node, controller) {
    var ctx = canvas.getCtx();

    // Guess as much as possible if the label will fit in the node
    if(controller.orientation == 'h' && node.getData("height") < node.getLabelData("size") * 1.5 ||
       controller.orientation == 'v' && node.getData("width") < ctx.measureText(node.name).width)
      return;

    var pos = node.pos.getc(true);

    ctx.fillText(node.name,
                 pos.x + node.getData("width") / 2,
                 pos.y + node.getData("height") / 2);
  },
});

/*
 * Class: Icicle.Label.SVG
 *
 * Implements labels using SVG (currently not supported in IE).
 *
 * Extends:
 *
 * <Graph.Label.SVG>
 *
 * See also:
 *
 * <Hypertree.Label>, <ST.Label>, <Hypertree>, <RGraph>, <ST>, <Graph>.
 *
 */
$jit.Icicle.Label.SVG = new Class( {
  Implements: Graph.Label.SVG,

  initialize: function(viz){
    this.viz = viz;
  },

  /*
   * Method: placeLabel
   *
   * Overrides abstract method placeLabel in <Graph.Plot>.
   *
   * Parameters:
   *
   * tag - A DOM label element.
   * node - A <Graph.Node>.
   * controller - A configuration/controller object passed to the visualization.
   */
  placeLabel: function(tag, node, controller){
    var pos = node.pos.getc(true), canvas = this.viz.canvas;
    var radius = canvas.getSize();
    var labelPos = {
      x: Math.round(pos.x + radius.width / 2),
      y: Math.round(pos.y + radius.height / 2)
    };
    tag.setAttribute('x', labelPos.x);
    tag.setAttribute('y', labelPos.y);

    controller.onPlaceLabel(tag, node);
  }
});

/*
 * Class: Icicle.Label.HTML
 *
 * Implements labels using plain old HTML.
 *
 * Extends:
 *
 * <Icicle.Label.DOM>, <Graph.Label.HTML>
 *
 * See also:
 *
 * <Hypertree.Label>, <ST.Label>, <Hypertree>, <RGraph>, <ST>, <Graph>.
 *
*/
$jit.Icicle.Label.HTML = new Class( {
  Implements: Graph.Label.HTML,

  initialize: function(viz){
    this.viz = viz;
  },

  /*
   * Method: placeLabel
   *
   * Overrides abstract method placeLabel in <Graph.Plot>.
   *
   * Parameters:
   *
   * tag - A DOM label element.
   * node - A <Graph.Node>.
   * controller - A configuration/controller object passed to the visualization.
   */
  placeLabel: function(tag, node, controller){
    var pos = node.pos.getc(true), canvas = this.viz.canvas;
    var radius = canvas.getSize();
    var labelPos = {
      x: Math.round(pos.x + radius.width / 2),
      y: Math.round(pos.y + radius.height / 2)
    };

    var style = tag.style;
    style.left = labelPos.x + 'px';
    style.top = labelPos.y + 'px';
    style.display = '';

    controller.onPlaceLabel(tag, node);
  }
});

/*
 * Class: Icicle.Plot.NodeTypes
 *
 * Here are implemented all kinds of node rendering functions.
 * Rendering functions implemented are 'none' and 'rectangle'
 *
 * You can add new Node types by implementing a new method in this class
 *
 * Example:
 *
 * (start code js)
 *   Icicle.Plot.NodeTypes.implement({
 *     'newnodetypename': function(node, canvas) {
 *       //Render my node here.
 *     }
 *   });
 * (end code)
 */
$jit.Icicle.Plot.NodeTypes = new Class( {
  'none': {
    'render': $.empty
  },

  'rectangle': {
    'render': function(node, canvas) {
      var offset = this.viz.config.offset;
      var width = node.getData('width');
      var height = node.getData('height');
      var pos = node.pos.getc(true);
      var posx = pos.x + offset / 2, posy = pos.y + offset / 2;
      var ctx = canvas.getCtx();

      var startColor = [15, 100, 100]; // HSV
      var color = startColor.slice(0);

      color[0] = (color[0] + 30 * node._depth) % 360;
      color[1] = ((color[1] - (1 - node.getData('height') / this.viz.canvas.getSize().height)*100/4) + 100) % 101;

      ctx.fillStyle = $.hsvToHex(color);
      ctx.fillRect(posx, posy, Math.max(0, width - offset), Math.max(0, height - offset));
      color[2] = 40;
      ctx.strokeStyle = $.hsvToHex(color);
      ctx.strokeRect(pos.x, pos.y, width, height);
    },

    'contains': function(node, pos) {
      if(this.viz.clickedNode && !$jit.Graph.Util.isDescendantOf(node, this.viz.clickedNode.id)) return false;
      var npos = node.pos.getc(true),
          width = node.getData('width'),
          height = node.getData('height');
      return this.nodeHelper.rectangle.contains({x: npos.x + width/2, y: npos.y + height/2}, pos, width, height);
    }
  }
});

$jit.Icicle.Plot.EdgeTypes = new Class( {
  'none': $.empty
});

