import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { GraphData, GraphNode, GraphLink } from '../types';

interface KnowledgeGraphProps {
  data: GraphData;
  onNodeClick: (nodeId: string) => void;
}

const KnowledgeGraph: React.FC<KnowledgeGraphProps> = ({ data, onNodeClick }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!data.nodes.length || !svgRef.current) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    // Clear previous
    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3.select(svgRef.current)
      .attr("viewBox", [0, 0, width, height])
      .style("max-width", "100%")
      .style("height", "auto");

    // Simulation
    const simulation = d3.forceSimulation(data.nodes)
      .force("link", d3.forceLink(data.links).id((d: any) => d.id).distance(150))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2));

    // Links
    const link = svg.append("g")
      .attr("stroke", "#94a3b8")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(data.links)
      .join("line")
      .attr("stroke-width", 1.5);

    // Link Labels
    const linkLabel = svg.append("g")
      .attr("class", "link-labels")
      .selectAll("text")
      .data(data.links)
      .join("text")
      .text((d) => d.relationship)
      .attr("font-size", "10px")
      .attr("fill", "#64748b")
      .attr("text-anchor", "middle");

    // Nodes
    const node = svg.append("g")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .selectAll("circle")
      .data(data.nodes)
      .join("circle")
      .attr("r", (d) => d.id === 'LoRA' || d.id === 'Parameter-Efficient Fine-Tuning' ? 25 : 15) // Highlight core nodes
      .attr("fill", (d) => {
          if (d.group === 1) return "#0ea5e9"; // Blue for Core
          if (d.group === 0) return "#94a3b8"; // Slate for Predecessor
          return "#10b981"; // Emerald for Successor
      })
      .call(drag(simulation) as any)
      .on("click", (event, d) => onNodeClick(d.id));

    // Labels
    const label = svg.append("g")
      .selectAll("text")
      .data(data.nodes)
      .join("text")
      .text((d) => d.id)
      .attr("x", 18)
      .attr("y", 5)
      .attr("font-family", "sans-serif")
      .attr("font-size", "12px")
      .attr("fill", "#334155")
      .attr("font-weight", "bold");

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      linkLabel
        .attr("x", (d: any) => (d.source.x + d.target.x) / 2)
        .attr("y", (d: any) => (d.source.y + d.target.y) / 2);

      node
        .attr("cx", (d: any) => d.x)
        .attr("cy", (d: any) => d.y);
        
      label
        .attr("x", (d: any) => d.x + ((d.id === 'LoRA' || d.id === 'Parameter-Efficient Fine-Tuning') ? 28 : 18))
        .attr("y", (d: any) => d.y + 5);
    });

    function drag(simulation: d3.Simulation<GraphNode, undefined>) {
      function dragstarted(event: any) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      }
      
      function dragged(event: any) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      }
      
      function dragended(event: any) {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
      }
      
      return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
    }

  }, [data, onNodeClick]);

  return (
    <div className="w-full h-full bg-slate-50 border-b border-slate-200 relative overflow-hidden">
        <div className="absolute top-4 left-4 bg-white/80 backdrop-blur p-2 rounded-md shadow-sm z-10 text-xs text-slate-500">
            <div className="flex items-center gap-2 mb-1"><span className="w-3 h-3 rounded-full bg-slate-400"></span> Predecessor</div>
            <div className="flex items-center gap-2 mb-1"><span className="w-3 h-3 rounded-full bg-sky-500"></span> Core Topic</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-emerald-500"></span> Successor</div>
        </div>
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
};

export default KnowledgeGraph;
