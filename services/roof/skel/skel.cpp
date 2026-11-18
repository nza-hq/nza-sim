// Copied from nza-twin-lab @ 4da46dc (services/roof/skel/skel.cpp) on 2026-10-01. Diverged: yes — HAND-EDITED IN DECODED (Brief 29 P1, Route E): a second mode, `--weighted`, reads an angle per contour edge and returns one face per edge with each vertex's (x, y, time) from CGAL's weighted straight skeleton. The unweighted mode is the lab's, with its printer shared. See docs/provenance.md §4.
// nza-twin-lab roof service — the straight skeleton, and nothing else (Brief 07, D28 route 2).
//
// Brief 29 (Route E), `skel --weighted`: the same rings, but each vertex line carries the slope
// angle (degrees, 0 < a ≤ 90; 90 = a vertical gable end) of the edge that STARTS at it. Weight =
// tan(angle), so a vertex's time is its height above the eave plane; the output is the unweighted
// mode's (one face per contour edge, x y time) and the Python lifts z = eave + time. A weighted
// skeleton cannot hold a 0° face — a flat edge is a level, not an angle (brief D5) — so angles ≤ 0
// are refused here.
//
// stdin (weighted):  R · then per ring: k · then k lines "x y angle"
// stdout (weighted): F · then per face: m · then m lines "x y time"
//
// The conda-forge CGAL Python bindings do not expose Straight_skeleton_2, so this is the
// smallest possible bridge: one polygon with holes in on stdin, its interior straight skeleton
// out on stdout, one face per contour edge with each vertex's (x, y, time). The Python service
// lifts `time` to a height (z = eave + time · tan pitch) and does everything else. CGAL is GPL-3
// and stays here, server-side (nothing from this file reaches a browser).
//
// stdin:  R                (rings: 1 outer + holes)
//         k                (vertices of ring)
//         x y              (× k, any winding)
// stdout: F                (faces)
//         m                (vertices of face; first two are the contour edge, in order)
//         x y t            (× m, CCW around the face)
// exit 2 with a message on stderr for an invalid (non-simple) polygon.
#include <CGAL/Exact_predicates_inexact_constructions_kernel.h>
#include <CGAL/Polygon_2.h>
#include <CGAL/Polygon_with_holes_2.h>
#include <CGAL/create_straight_skeleton_2.h>
#include <CGAL/create_straight_skeleton_from_polygon_with_holes_2.h>
#include <CGAL/create_weighted_straight_skeleton_2.h>
#include <CGAL/create_weighted_straight_skeleton_from_polygon_with_holes_2.h>
#include <CGAL/version.h>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

typedef CGAL::Exact_predicates_inexact_constructions_kernel K;
typedef K::Point_2 Point;
typedef CGAL::Polygon_2<K> Polygon;
typedef CGAL::Polygon_with_holes_2<K> PolygonWithHoles;
typedef CGAL::Straight_skeleton_2<K> Ss;

// One face per contour edge, each vertex as (x, y, time); the first two vertices are the edge.
static void print_faces(const std::shared_ptr<Ss>& ss) {
  std::printf("%d\n", (int)ss->size_of_faces());
  for (auto f = ss->faces_begin(); f != ss->faces_end(); ++f) {
    // Start from the contour halfedge so the first two vertices are the defining edge.
    Ss::Halfedge_const_handle start = f->halfedge();
    Ss::Halfedge_const_handle h = start;
    do {
      if (!h->is_bisector()) break;
      h = h->next();
    } while (h != start);
    int m = 0;
    Ss::Halfedge_const_handle c = h;
    do {
      m++;
      c = c->next();
    } while (c != h);
    std::printf("%d\n", m);
    c = h;
    Ss::Halfedge_const_handle prev = h->prev();
    // A halfedge points to its target vertex; the ring starts at the contour edge's source.
    std::printf("%.10g %.10g %.10g\n", CGAL::to_double(prev->vertex()->point().x()),
                CGAL::to_double(prev->vertex()->point().y()), CGAL::to_double(prev->vertex()->time()));
    do {
      if (c->next() == h) break;
      std::printf("%.10g %.10g %.10g\n", CGAL::to_double(c->vertex()->point().x()),
                  CGAL::to_double(c->vertex()->point().y()), CGAL::to_double(c->vertex()->time()));
      c = c->next();
    } while (c != h);
  }
}

// Brief 29 (Route E): rings with an angle per edge → the weighted skeleton's faces, (x, y, time).
// Weight = tan(angle): a face at angle a offset d from its edge stands d·tan a high, and CGAL moves
// that edge at speed 1/tan a, so every vertex's time IS its height above the eave plane. A vertical
// gable end is tan 89.9° — the centimetre it leans over six metres is what keeps the skeleton finite.
static const double VERTICAL_DEG = 89.9;
static const double PI = 3.14159265358979323846;

static int weighted() {
  int rings = 0;
  if (!(std::cin >> rings) || rings < 1) {
    std::fprintf(stderr, "no rings\n");
    return 2;
  }
  std::vector<Polygon> polys;
  std::vector<std::vector<double>> weights;
  for (int r = 0; r < rings; r++) {
    int k = 0;
    std::cin >> k;
    Polygon p;
    std::vector<double> w;
    for (int i = 0; i < k; i++) {
      double x, y, ang;
      std::cin >> x >> y >> ang;
      if (!(ang > 0.0) || ang > 90.0) {
        std::fprintf(stderr, "edge %d of ring %d: angle %g is not in (0, 90]\n", i, r, ang);
        return 2;
      }
      p.push_back(Point(x, y));
      w.push_back(std::tan(std::min(ang, VERTICAL_DEG) * PI / 180.0));
    }
    if (k < 3 || !p.is_simple()) {
      std::fprintf(stderr, "ring %d is not a simple polygon\n", r);
      return 2;
    }
    // Outer CCW, holes CW. An angle belongs to the edge that STARTS at its vertex; when the ring is
    // reversed that edge now ENDS there, so the weights are re-indexed to stay with their edges.
    bool rev = (r == 0 && p.is_clockwise_oriented()) || (r > 0 && p.is_counterclockwise_oriented());
    if (rev) {
      p.reverse_orientation();
      std::vector<double> b(k);
      for (int i = 0; i < k; i++) b[i] = w[(2 * k - 2 - i) % k];
      w = b;
    }
    // CGAL's weight i belongs to the edge ENDING at vertex i (measured, Brief 29 P1: a rectangle
    // given [30, 90, 30, 90] on its [long, short, long, short] edges came back with the short ends
    // pitched); ours belongs to the edge starting there, so rotate by one.
    std::vector<double> rotated(k);
    for (int i = 0; i < k; i++) rotated[(i + 1) % k] = w[i];
    polys.push_back(p);
    weights.push_back(rotated);
  }
  PolygonWithHoles pwh(polys[0]);
  for (size_t r = 1; r < polys.size(); r++) pwh.add_hole(polys[r]);
  std::shared_ptr<Ss> ss = CGAL::create_interior_weighted_straight_skeleton_2(pwh, weights);
  if (!ss) {
    std::fprintf(stderr, "weighted skeleton failed\n");
    return 2;
  }
  print_faces(ss);
  return 0;
}

int main(int argc, char** argv) {
  if (argc > 1 && std::string(argv[1]) == "--version") {
    std::printf("CGAL %s\n", CGAL_VERSION_STR);
    return 0;
  }
  if (argc > 1 && std::string(argv[1]) == "--weighted") return weighted();
  int rings = 0;
  if (!(std::cin >> rings) || rings < 1) {
    std::fprintf(stderr, "no rings\n");
    return 2;
  }
  std::vector<Polygon> polys;
  for (int r = 0; r < rings; r++) {
    int k = 0;
    std::cin >> k;
    Polygon p;
    for (int i = 0; i < k; i++) {
      double x, y;
      std::cin >> x >> y;
      p.push_back(Point(x, y));
    }
    if (k < 3 || !p.is_simple()) {
      std::fprintf(stderr, "ring %d is not a simple polygon\n", r);
      return 2;
    }
    // Outer CCW, holes CW (CGAL's convention for interior skeletons).
    if (r == 0 && p.is_clockwise_oriented()) p.reverse_orientation();
    if (r > 0 && p.is_counterclockwise_oriented()) p.reverse_orientation();
    polys.push_back(p);
  }
  PolygonWithHoles pwh(polys[0]);
  for (size_t r = 1; r < polys.size(); r++) pwh.add_hole(polys[r]);
  std::shared_ptr<Ss> ss = CGAL::create_interior_straight_skeleton_2(pwh);
  if (!ss) {
    std::fprintf(stderr, "skeleton failed\n");
    return 2;
  }
  print_faces(ss);
  return 0;
}
